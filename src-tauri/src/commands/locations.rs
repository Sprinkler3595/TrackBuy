use tauri::State;
use uuid::Uuid;

use crate::commands::auth::AppState;
use crate::db::models::{CreateLocationRequest, Location};

#[tauri::command]
pub fn get_locations(state: State<'_, AppState>) -> Result<Vec<Location>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, name, icon, created_at, updated_at FROM locations ORDER BY name")
        .map_err(|e| e.to_string())?;

    let locations = stmt
        .query_map([], |row| {
            Ok(Location {
                id: row.get(0)?,
                name: row.get(1)?,
                icon: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(locations)
}

#[tauri::command]
pub fn create_location(
    state: State<'_, AppState>,
    location: CreateLocationRequest,
) -> Result<Location, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let id = Uuid::new_v4().to_string();
    let icon = location.icon.unwrap_or_else(|| "MapPin".to_string());

    conn.execute(
        "INSERT INTO locations (id, name, icon) VALUES (?1, ?2, ?3)",
        rusqlite::params![id, location.name, icon],
    )
    .map_err(|e| e.to_string())?;

    conn.query_row(
        "SELECT id, name, icon, created_at, updated_at FROM locations WHERE id = ?1",
        [&id],
        |row| Ok(Location {
            id: row.get(0)?,
            name: row.get(1)?,
            icon: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
        }),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_location(state: State<'_, AppState>, location: Location) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    conn.execute(
        "UPDATE locations SET name = ?1, icon = ?2, updated_at = datetime('now') WHERE id = ?3",
        rusqlite::params![location.name, location.icon, location.id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_location(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    conn.execute("DELETE FROM locations WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
