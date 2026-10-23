const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');
const EXPORT_DIR = path.join(DATA_DIR, 'exports');
const PLAN_DIR = path.join(DATA_DIR, 'plan-exports');
const DB_PATH = path.join(DATA_DIR, 'change-app.db');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(EXPORT_DIR, { recursive: true });
fs.mkdirSync(PLAN_DIR, { recursive: true });

const db = new sqlite3.Database(DB_PATH);
db.configure('busyTimeout', 5000);

const OPTION_GROUPS = {
  department: '申请部门',
  system: '变更系统',
  changeCategory: '变更类别',
};

const DEFAULT_OPTIONS = {
  department: ['研发二中心', '财务部', '信息技术部', '运营管理部', '风险管理部'],
  system: ['财务管理系统', '代销管理系统', '司库系统', '统一身份认证系统'],
  changeCategory: ['需求', '优化', '缺陷修复'],
};

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) reject(error);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) reject(error);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) reject(error);
      else resolve(rows);
    });
  });
}

async function ensureColumn(table, column, definition) {
  const columns = await all(`PRAGMA table_info(${table})`);
  if (!columns.some((item) => item.name === column)) {
    await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function initDb() {
  await run('PRAGMA journal_mode = WAL');
  await run('PRAGMA foreign_keys = ON');

  await run(`
    CREATE TABLE IF NOT EXISTS dropdown_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_name TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(group_name, value)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS export_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exported_at TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      form_data TEXT NOT NULL,
      change_system TEXT NOT NULL,
      applicant TEXT NOT NULL,
      expected_change_date TEXT NOT NULL,
      source_record_id INTEGER
    )
  `);

  await ensureColumn('export_records', 'source_record_id', 'INTEGER');
  await run('CREATE INDEX IF NOT EXISTS idx_export_records_time ON export_records(exported_at DESC)');

  await run(`
    CREATE TABLE IF NOT EXISTS change_plan_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exported_at TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      plan_data TEXT NOT NULL,
      change_system TEXT NOT NULL,
      expected_change_date TEXT NOT NULL,
      source_plan_record_id INTEGER,
      source_application_record_id INTEGER,
      template_id INTEGER
    )
  `);
  await run('CREATE INDEX IF NOT EXISTS idx_plan_records_time ON change_plan_records(exported_at DESC)');

  await run(`
    CREATE TABLE IF NOT EXISTS change_plan_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      plan_data TEXT NOT NULL,
      source_plan_record_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS change_plan_sessions (
      id TEXT PRIMARY KEY,
      context TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // 仅在首次初始化时写入示例选项。用户后续删除的选项不会因重启被重新写回。
  const seeded = await get('SELECT value FROM app_meta WHERE key = ?', ['default_options_seeded']);
  if (!seeded) {
    const now = new Date().toISOString();
    for (const [group, values] of Object.entries(DEFAULT_OPTIONS)) {
      for (const value of values) {
        await run(
          'INSERT OR IGNORE INTO dropdown_options (group_name, value, created_at) VALUES (?, ?, ?)',
          [group, value, now],
        );
      }
    }
    await run('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [
      'default_options_seeded',
      new Date().toISOString(),
    ]);
  }
}

async function listOptions() {
  const rows = await all(
    'SELECT id, group_name AS groupName, value FROM dropdown_options ORDER BY group_name, id ASC',
  );
  const groups = { department: [], system: [], changeCategory: [] };
  for (const row of rows) {
    if (groups[row.groupName]) {
      groups[row.groupName].push({ id: row.id, value: row.value });
    }
  }
  return groups;
}

async function addOption(group, value) {
  const result = await run(
    'INSERT INTO dropdown_options (group_name, value, created_at) VALUES (?, ?, ?)',
    [group, value, new Date().toISOString()],
  );
  return { id: result.lastID, value };
}

async function deleteOption(id) {
  return run('DELETE FROM dropdown_options WHERE id = ?', [id]);
}

async function importOptionValues(group, values) {
  const uniqueValues = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  let added = 0;
  const now = new Date().toISOString();

  await run('BEGIN IMMEDIATE');
  try {
    for (const value of uniqueValues) {
      const result = await run(
        'INSERT OR IGNORE INTO dropdown_options (group_name, value, created_at) VALUES (?, ?, ?)',
        [group, value, now],
      );
      added += result.changes;
    }
    await run('COMMIT');
  } catch (error) {
    await run('ROLLBACK');
    throw error;
  }

  return { added, skipped: uniqueValues.length - added, total: uniqueValues.length };
}

async function createExportRecord(record) {
  const result = await run(
    `INSERT INTO export_records
      (exported_at, file_name, file_path, form_data, change_system, applicant, expected_change_date, source_record_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.exportedAt,
      record.fileName,
      record.filePath,
      JSON.stringify(record.formData),
      record.changeSystem,
      record.applicant,
      record.expectedChangeDate,
      record.sourceRecordId || null,
    ],
  );
  return result.lastID;
}

async function listExportRecords() {
  return all(`
    SELECT id,
           exported_at AS exportedAt,
           file_name AS fileName,
           change_system AS changeSystem,
           applicant,
           expected_change_date AS expectedChangeDate,
           source_record_id AS sourceRecordId
    FROM export_records
    ORDER BY id DESC
  `);
}

async function getExportRecord(id) {
  const row = await get(
    `SELECT id,
            exported_at AS exportedAt,
            file_name AS fileName,
            file_path AS filePath,
            form_data AS formData,
            change_system AS changeSystem,
            applicant,
            expected_change_date AS expectedChangeDate,
            source_record_id AS sourceRecordId
     FROM export_records
     WHERE id = ?`,
    [id],
  );
  if (!row) return null;
  return { ...row, formData: JSON.parse(row.formData) };
}

async function createPlanRecord(record) {
  const result = await run(
    `INSERT INTO change_plan_records
      (exported_at, file_name, file_path, plan_data, change_system,
       expected_change_date, source_plan_record_id, source_application_record_id, template_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.exportedAt,
      record.fileName,
      record.filePath,
      JSON.stringify(record.planData),
      record.changeSystem,
      record.expectedChangeDate,
      record.sourcePlanRecordId || null,
      record.sourceApplicationRecordId || null,
      record.templateId || null,
    ],
  );
  return result.lastID;
}

async function listPlanRecords() {
  return all(`
    SELECT id,
           exported_at AS exportedAt,
           file_name AS fileName,
           change_system AS changeSystem,
           expected_change_date AS expectedChangeDate,
           source_plan_record_id AS sourcePlanRecordId,
           source_application_record_id AS sourceApplicationRecordId,
           template_id AS templateId
    FROM change_plan_records
    ORDER BY id DESC
  `);
}

async function getPlanRecord(id) {
  const row = await get(
    `SELECT id,
            exported_at AS exportedAt,
            file_name AS fileName,
            file_path AS filePath,
            plan_data AS planData,
            change_system AS changeSystem,
            expected_change_date AS expectedChangeDate,
            source_plan_record_id AS sourcePlanRecordId,
            source_application_record_id AS sourceApplicationRecordId,
            template_id AS templateId
     FROM change_plan_records
     WHERE id = ?`,
    [id],
  );
  if (!row) return null;
  return { ...row, planData: JSON.parse(row.planData) };
}

async function createPlanTemplate(template) {
  const now = new Date().toISOString();
  const result = await run(
    `INSERT INTO change_plan_templates
      (name, plan_data, source_plan_record_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [
      template.name,
      JSON.stringify(template.planData),
      template.sourcePlanRecordId || null,
      now,
      now,
    ],
  );
  return result.lastID;
}

async function listPlanTemplates() {
  return all(`
    SELECT id,
           name,
           source_plan_record_id AS sourcePlanRecordId,
           created_at AS createdAt,
           updated_at AS updatedAt
    FROM change_plan_templates
    ORDER BY updated_at DESC, id DESC
  `);
}

async function getPlanTemplate(id) {
  const row = await get(
    `SELECT id,
            name,
            plan_data AS planData,
            source_plan_record_id AS sourcePlanRecordId,
            created_at AS createdAt,
            updated_at AS updatedAt
     FROM change_plan_templates
     WHERE id = ?`,
    [id],
  );
  if (!row) return null;
  return { ...row, planData: JSON.parse(row.planData) };
}

async function deletePlanTemplate(id) {
  const result = await run('DELETE FROM change_plan_templates WHERE id = ?', [id]);
  return result.changes;
}

async function createPlanSession(session) {
  await run(
    'INSERT INTO change_plan_sessions (id, context, created_at) VALUES (?, ?, ?)',
    [session.id, JSON.stringify(session.context), session.createdAt],
  );
  return session.id;
}

async function getPlanSession(id) {
  const row = await get(
    'SELECT id, context, created_at AS createdAt FROM change_plan_sessions WHERE id = ?',
    [id],
  );
  if (!row) return null;
  return { ...row, context: JSON.parse(row.context) };
}

async function prunePlanSessions(beforeISO) {
  return run('DELETE FROM change_plan_sessions WHERE created_at < ?', [beforeISO]);
}

module.exports = {
  DATA_DIR,
  EXPORT_DIR,
  PLAN_DIR,
  OPTION_GROUPS,
  initDb,
  listOptions,
  addOption,
  deleteOption,
  importOptionValues,
  createExportRecord,
  listExportRecords,
  getExportRecord,
  createPlanRecord,
  listPlanRecords,
  getPlanRecord,
  createPlanTemplate,
  listPlanTemplates,
  getPlanTemplate,
  deletePlanTemplate,
  createPlanSession,
  getPlanSession,
  prunePlanSessions,
};
