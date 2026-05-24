use tauri::State;

use crate::commands::auth::AppState;
use crate::db::models::FilenameTemplate;

const TEMPLATE_SELECT_COLUMNS: &str = "attachment_type, template, updated_at";

fn row_to_template(row: &rusqlite::Row<'_>) -> rusqlite::Result<FilenameTemplate> {
    Ok(FilenameTemplate {
        attachment_type: row.get(0)?,
        template: row.get(1)?,
        updated_at: row.get(2)?,
    })
}

#[tauri::command]
pub fn list_filename_templates(
    state: State<'_, AppState>,
) -> Result<Vec<FilenameTemplate>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let sql = format!(
        "SELECT {} FROM filename_templates ORDER BY attachment_type",
        TEMPLATE_SELECT_COLUMNS
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], row_to_template)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(rows)
}

#[tauri::command]
pub fn set_filename_template(
    state: State<'_, AppState>,
    attachment_type: String,
    template: String,
) -> Result<FilenameTemplate, String> {
    let trimmed = template.trim();
    if trimmed.is_empty() {
        return Err("Le template ne peut pas être vide".to_string());
    }
    if trimmed.len() > 500 {
        return Err("Template trop long (max 500 caractères)".to_string());
    }

    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    conn.execute(
        "INSERT INTO filename_templates (attachment_type, template, updated_at)
         VALUES (?1, ?2, datetime('now'))
         ON CONFLICT(attachment_type) DO UPDATE
         SET template = excluded.template, updated_at = datetime('now')",
        rusqlite::params![attachment_type, trimmed],
    )
    .map_err(|e| e.to_string())?;

    let select_sql = format!(
        "SELECT {} FROM filename_templates WHERE attachment_type = ?1",
        TEMPLATE_SELECT_COLUMNS
    );
    conn.query_row(&select_sql, [&attachment_type], row_to_template)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reset_filename_template(
    state: State<'_, AppState>,
    attachment_type: String,
) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    conn.execute(
        "DELETE FROM filename_templates WHERE attachment_type = ?1",
        [&attachment_type],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}
