use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::commands::auth::AppState;

/// A person attached to the active vault — the household. Used to attribute
/// individual LAMal premiums, attribute purchases (frais médicaux du conjoint,
/// fournitures scolaires d'un enfant…), and split the annual tax declaration
/// between members.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HouseholdMember {
    pub id: String,
    pub name: String,
    /// 'self' | 'spouse' | 'child' | 'parent' | 'other'
    pub relation: String,
    pub birth_date: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateHouseholdMemberRequest {
    pub name: String,
    pub relation: Option<String>,
    pub birth_date: Option<String>,
    pub notes: Option<String>,
}

fn row_to_member(row: &rusqlite::Row<'_>) -> rusqlite::Result<HouseholdMember> {
    Ok(HouseholdMember {
        id: row.get(0)?,
        name: row.get(1)?,
        relation: row.get(2)?,
        birth_date: row.get(3)?,
        notes: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

#[tauri::command]
pub fn list_household_members(
    state: State<'_, AppState>,
) -> Result<Vec<HouseholdMember>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, name, relation, birth_date, notes, created_at, updated_at
             FROM household_members ORDER BY
                 CASE relation
                     WHEN 'self' THEN 0
                     WHEN 'spouse' THEN 1
                     WHEN 'child' THEN 2
                     WHEN 'parent' THEN 3
                     ELSE 4 END,
                 name",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], row_to_member)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn create_household_member(
    state: State<'_, AppState>,
    member: CreateHouseholdMemberRequest,
) -> Result<HouseholdMember, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let id = Uuid::new_v4().to_string();
    let relation = member.relation.unwrap_or_else(|| "other".to_string());

    conn.execute(
        "INSERT INTO household_members (id, name, relation, birth_date, notes)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![id, member.name, relation, member.birth_date, member.notes],
    )
    .map_err(|e| e.to_string())?;

    conn.query_row(
        "SELECT id, name, relation, birth_date, notes, created_at, updated_at
         FROM household_members WHERE id = ?1",
        [&id],
        row_to_member,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_household_member(
    state: State<'_, AppState>,
    member: HouseholdMember,
) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    conn.execute(
        "UPDATE household_members SET name = ?1, relation = ?2, birth_date = ?3,
         notes = ?4, updated_at = datetime('now') WHERE id = ?5",
        rusqlite::params![
            member.name,
            member.relation,
            member.birth_date,
            member.notes,
            member.id
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_household_member(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    conn.execute("DELETE FROM household_members WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Set or clear the household-member attribution on an item.
/// `member_id = None` means "shared by the whole household".
#[tauri::command]
pub fn set_item_attribution(
    state: State<'_, AppState>,
    item_id: String,
    member_id: Option<String>,
) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    conn.execute(
        "UPDATE items SET attributed_to_member_id = ?1, updated_at = datetime('now')
         WHERE id = ?2",
        rusqlite::params![member_id, item_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_engagement_attribution(
    state: State<'_, AppState>,
    engagement_id: String,
    member_id: Option<String>,
) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    conn.execute(
        "UPDATE engagements SET attributed_to_member_id = ?1, updated_at = datetime('now')
         WHERE id = ?2",
        rusqlite::params![member_id, engagement_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
