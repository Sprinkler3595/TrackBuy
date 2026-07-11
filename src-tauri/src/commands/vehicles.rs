use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::commands::auth::AppState;

/// A vehicle: the canonical identity that groups a car's leasing, insurance and
/// tax engagements (and, from v27, its expense ledger). Mirrors the `vehicles`
/// table 1:1.
#[derive(Debug, Serialize, Deserialize)]
pub struct Vehicle {
    pub id: String,
    pub name: String,
    pub make: Option<String>,
    pub model: Option<String>,
    pub plate: Option<String>,
    pub vin: Option<String>,
    pub registration_number: Option<String>,
    pub category: Option<String>,
    pub energy_type: Option<String>,
    pub first_registration: Option<String>,
    pub canton: Option<String>,
    pub color: Option<String>,
    pub power_kw: Option<f64>,
    pub displacement_cc: Option<i64>,
    pub weight_kg: Option<i64>,
    pub battery_kwh: Option<f64>,
    pub purchase_date: Option<String>,
    pub purchase_price: Option<f64>,
    pub odometer_km: Option<i64>,
    pub status: String,
    pub sold_on: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Payload for creating a vehicle — everything but `name` is optional.
#[derive(Debug, Deserialize)]
pub struct CreateVehicleRequest {
    pub name: String,
    #[serde(default)]
    pub make: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub plate: Option<String>,
    #[serde(default)]
    pub vin: Option<String>,
    #[serde(default)]
    pub registration_number: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub energy_type: Option<String>,
    #[serde(default)]
    pub first_registration: Option<String>,
    #[serde(default)]
    pub canton: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub power_kw: Option<f64>,
    #[serde(default)]
    pub displacement_cc: Option<i64>,
    #[serde(default)]
    pub weight_kg: Option<i64>,
    #[serde(default)]
    pub battery_kwh: Option<f64>,
    #[serde(default)]
    pub purchase_date: Option<String>,
    #[serde(default)]
    pub purchase_price: Option<f64>,
    #[serde(default)]
    pub odometer_km: Option<i64>,
    #[serde(default)]
    pub notes: Option<String>,
}

/// Lightweight summary of an engagement attached (or attachable) to a vehicle —
/// enough to render the "Contrats" tab and the link picker without pulling the
/// full (very wide) Engagement row.
#[derive(Debug, Serialize)]
pub struct VehicleEngagementSummary {
    pub id: String,
    pub name: String,
    pub engagement_type: String,
    pub current_amount: Option<f64>,
    pub currency: String,
    pub billing_cycle: String,
    pub status: String,
    pub next_due_date: Option<String>,
    pub contract_end_date: Option<String>,
    /// The plate stored on the contract itself — used to suggest links.
    pub vehicle_plate: Option<String>,
    pub vehicle_id: Option<String>,
}

/// Engagement types that describe a vehicle-related contract and can therefore
/// be attached to a vehicle (leasing, car insurance, fuel, and — once added —
/// the vehicle-tax type).
const VEHICLE_ENGAGEMENT_TYPES: &[&str] = &["leasing", "insurance_car", "fuel", "vehicle_tax"];

const VEHICLE_SELECT_COLUMNS: &str = "id, name, make, model, plate, vin, registration_number,
    category, energy_type, first_registration, canton, color, power_kw, displacement_cc,
    weight_kg, battery_kwh, purchase_date, purchase_price, odometer_km, status, sold_on, notes,
    created_at, updated_at";

fn row_to_vehicle(row: &rusqlite::Row<'_>) -> rusqlite::Result<Vehicle> {
    Ok(Vehicle {
        id: row.get(0)?,
        name: row.get(1)?,
        make: row.get(2)?,
        model: row.get(3)?,
        plate: row.get(4)?,
        vin: row.get(5)?,
        registration_number: row.get(6)?,
        category: row.get(7)?,
        energy_type: row.get(8)?,
        first_registration: row.get(9)?,
        canton: row.get(10)?,
        color: row.get(11)?,
        power_kw: row.get(12)?,
        displacement_cc: row.get(13)?,
        weight_kg: row.get(14)?,
        battery_kwh: row.get(15)?,
        purchase_date: row.get(16)?,
        purchase_price: row.get(17)?,
        odometer_km: row.get(18)?,
        status: row.get(19)?,
        sold_on: row.get(20)?,
        notes: row.get(21)?,
        created_at: row.get(22)?,
        updated_at: row.get(23)?,
    })
}

fn row_to_engagement_summary(row: &rusqlite::Row<'_>) -> rusqlite::Result<VehicleEngagementSummary> {
    Ok(VehicleEngagementSummary {
        id: row.get(0)?,
        name: row.get(1)?,
        engagement_type: row.get(2)?,
        current_amount: row.get(3)?,
        currency: row.get(4)?,
        billing_cycle: row.get(5)?,
        status: row.get(6)?,
        next_due_date: row.get(7)?,
        contract_end_date: row.get(8)?,
        vehicle_plate: row.get(9)?,
        vehicle_id: row.get(10)?,
    })
}

const ENGAGEMENT_SUMMARY_COLUMNS: &str = "id, name, engagement_type, current_amount, currency,
    billing_cycle, status, next_due_date, contract_end_date, vehicle_plate, vehicle_id";

#[tauri::command]
pub fn get_vehicles(state: State<'_, AppState>) -> Result<Vec<Vehicle>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let sql = format!(
        "SELECT {} FROM vehicles ORDER BY status = 'active' DESC, name",
        VEHICLE_SELECT_COLUMNS
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], row_to_vehicle)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn get_vehicle(state: State<'_, AppState>, id: String) -> Result<Vehicle, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;
    let sql = format!("SELECT {} FROM vehicles WHERE id = ?1", VEHICLE_SELECT_COLUMNS);
    conn.query_row(&sql, [&id], row_to_vehicle)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_vehicle(
    state: State<'_, AppState>,
    vehicle: CreateVehicleRequest,
) -> Result<Vehicle, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO vehicles (id, name, make, model, plate, vin, registration_number, category,
         energy_type, first_registration, canton, color, power_kw, displacement_cc, weight_kg,
         battery_kwh, purchase_date, purchase_price, odometer_km, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)",
        rusqlite::params![
            id, vehicle.name, vehicle.make, vehicle.model, vehicle.plate, vehicle.vin,
            vehicle.registration_number, vehicle.category, vehicle.energy_type,
            vehicle.first_registration, vehicle.canton, vehicle.color, vehicle.power_kw,
            vehicle.displacement_cc, vehicle.weight_kg, vehicle.battery_kwh, vehicle.purchase_date,
            vehicle.purchase_price, vehicle.odometer_km, vehicle.notes
        ],
    )
    .map_err(|e| e.to_string())?;

    let sql = format!("SELECT {} FROM vehicles WHERE id = ?1", VEHICLE_SELECT_COLUMNS);
    conn.query_row(&sql, [&id], row_to_vehicle)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_vehicle(state: State<'_, AppState>, vehicle: Vehicle) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    conn.execute(
        "UPDATE vehicles SET name = ?2, make = ?3, model = ?4, plate = ?5, vin = ?6,
         registration_number = ?7, category = ?8, energy_type = ?9, first_registration = ?10,
         canton = ?11, color = ?12, power_kw = ?13, displacement_cc = ?14, weight_kg = ?15,
         battery_kwh = ?16, purchase_date = ?17, purchase_price = ?18, odometer_km = ?19,
         status = ?20, sold_on = ?21, notes = ?22, updated_at = datetime('now')
         WHERE id = ?1",
        rusqlite::params![
            vehicle.id, vehicle.name, vehicle.make, vehicle.model, vehicle.plate, vehicle.vin,
            vehicle.registration_number, vehicle.category, vehicle.energy_type,
            vehicle.first_registration, vehicle.canton, vehicle.color, vehicle.power_kw,
            vehicle.displacement_cc, vehicle.weight_kg, vehicle.battery_kwh, vehicle.purchase_date,
            vehicle.purchase_price, vehicle.odometer_km, vehicle.status, vehicle.sold_on,
            vehicle.notes
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_vehicle(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;
    // Engagements keep existing; their vehicle_id is nulled by the FK's
    // ON DELETE SET NULL, so a deleted vehicle simply unlinks its contracts.
    conn.execute("DELETE FROM vehicles WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Engagements attached to a vehicle (its leasing, insurance, tax…), newest
/// contract end first.
#[tauri::command]
pub fn get_vehicle_engagements(
    state: State<'_, AppState>,
    vehicle_id: String,
) -> Result<Vec<VehicleEngagementSummary>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;
    let sql = format!(
        "SELECT {} FROM engagements WHERE vehicle_id = ?1
         ORDER BY status = 'active' DESC, engagement_type",
        ENGAGEMENT_SUMMARY_COLUMNS
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([&vehicle_id], row_to_engagement_summary)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// Vehicle-related engagements NOT yet attached to any vehicle — candidates for
/// linking. Carries each one's own plate so the UI can suggest matches.
#[tauri::command]
pub fn get_linkable_vehicle_engagements(
    state: State<'_, AppState>,
) -> Result<Vec<VehicleEngagementSummary>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    // Build the IN(...) placeholder list for the known vehicle engagement types.
    let placeholders = VEHICLE_ENGAGEMENT_TYPES
        .iter()
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "SELECT {} FROM engagements
         WHERE vehicle_id IS NULL AND engagement_type IN ({})
         ORDER BY status = 'active' DESC, engagement_type",
        ENGAGEMENT_SUMMARY_COLUMNS, placeholders
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let params = rusqlite::params_from_iter(VEHICLE_ENGAGEMENT_TYPES.iter());
    let rows = stmt
        .query_map(params, row_to_engagement_summary)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// Attach (or, with `vehicle_id = None`, detach) an engagement to/from a
/// vehicle.
#[tauri::command]
pub fn set_engagement_vehicle(
    state: State<'_, AppState>,
    engagement_id: String,
    vehicle_id: Option<String>,
) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;
    conn.execute(
        "UPDATE engagements SET vehicle_id = ?1, updated_at = datetime('now') WHERE id = ?2",
        rusqlite::params![vehicle_id, engagement_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ===========================================================================
// Vehicle expense ledger (charging, fuel, tires, maintenance, repairs…)
// ===========================================================================

/// One expense tied to a vehicle. Mirrors the `vehicle_expenses` table (+ a
/// joined `card_name` for display).
#[derive(Debug, Serialize, Deserialize)]
pub struct VehicleExpense {
    pub id: String,
    pub vehicle_id: String,
    pub expense_date: String,
    pub category: String,
    pub description: Option<String>,
    pub amount: f64,
    pub currency: String,
    pub odometer_km: Option<i64>,
    pub quantity: Option<f64>,
    pub unit: Option<String>,
    pub unit_price: Option<f64>,
    pub location: Option<String>,
    pub merchant: Option<String>,
    pub payment_card_id: Option<String>,
    pub next_due_km: Option<i64>,
    pub next_due_date: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub card_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateVehicleExpenseRequest {
    pub vehicle_id: String,
    pub expense_date: String,
    pub category: String,
    pub amount: f64,
    #[serde(default)]
    pub currency: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub odometer_km: Option<i64>,
    #[serde(default)]
    pub quantity: Option<f64>,
    #[serde(default)]
    pub unit: Option<String>,
    #[serde(default)]
    pub unit_price: Option<f64>,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub merchant: Option<String>,
    #[serde(default)]
    pub payment_card_id: Option<String>,
    #[serde(default)]
    pub next_due_km: Option<i64>,
    #[serde(default)]
    pub next_due_date: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

/// Per-category total for the expense summary.
#[derive(Debug, Serialize)]
pub struct VehicleExpenseCategoryTotal {
    pub category: String,
    pub total: f64,
    pub count: i64,
}

/// Aggregate figures for a vehicle's expenses, shown on the fiche.
#[derive(Debug, Serialize)]
pub struct VehicleExpenseSummary {
    pub total: f64,
    pub total_year: f64,
    pub count: i64,
    pub by_category: Vec<VehicleExpenseCategoryTotal>,
}

const EXPENSE_SELECT_COLUMNS: &str = "ve.id, ve.vehicle_id, ve.expense_date, ve.category,
    ve.description, ve.amount, ve.currency, ve.odometer_km, ve.quantity, ve.unit, ve.unit_price,
    ve.location, ve.merchant, ve.payment_card_id, ve.next_due_km, ve.next_due_date, ve.notes,
    ve.created_at, ve.updated_at, pc.name";

fn row_to_expense(row: &rusqlite::Row<'_>) -> rusqlite::Result<VehicleExpense> {
    Ok(VehicleExpense {
        id: row.get(0)?,
        vehicle_id: row.get(1)?,
        expense_date: row.get(2)?,
        category: row.get(3)?,
        description: row.get(4)?,
        amount: row.get(5)?,
        currency: row.get(6)?,
        odometer_km: row.get(7)?,
        quantity: row.get(8)?,
        unit: row.get(9)?,
        unit_price: row.get(10)?,
        location: row.get(11)?,
        merchant: row.get(12)?,
        payment_card_id: row.get(13)?,
        next_due_km: row.get(14)?,
        next_due_date: row.get(15)?,
        notes: row.get(16)?,
        created_at: row.get(17)?,
        updated_at: row.get(18)?,
        card_name: row.get(19)?,
    })
}

#[tauri::command]
pub fn get_vehicle_expenses(
    state: State<'_, AppState>,
    vehicle_id: String,
) -> Result<Vec<VehicleExpense>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;
    let sql = format!(
        "SELECT {} FROM vehicle_expenses ve
         LEFT JOIN payment_cards pc ON ve.payment_card_id = pc.id
         WHERE ve.vehicle_id = ?1
         ORDER BY ve.expense_date DESC, ve.created_at DESC",
        EXPENSE_SELECT_COLUMNS
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([&vehicle_id], row_to_expense)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn create_vehicle_expense(
    state: State<'_, AppState>,
    expense: CreateVehicleExpenseRequest,
) -> Result<VehicleExpense, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let id = Uuid::new_v4().to_string();
    let currency = expense.currency.unwrap_or_else(|| "CHF".to_string());
    conn.execute(
        "INSERT INTO vehicle_expenses (id, vehicle_id, expense_date, category, description, amount,
         currency, odometer_km, quantity, unit, unit_price, location, merchant, payment_card_id,
         next_due_km, next_due_date, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
        rusqlite::params![
            id, expense.vehicle_id, expense.expense_date, expense.category, expense.description,
            expense.amount, currency, expense.odometer_km, expense.quantity, expense.unit,
            expense.unit_price, expense.location, expense.merchant, expense.payment_card_id,
            expense.next_due_km, expense.next_due_date, expense.notes
        ],
    )
    .map_err(|e| e.to_string())?;

    let sql = format!(
        "SELECT {} FROM vehicle_expenses ve
         LEFT JOIN payment_cards pc ON ve.payment_card_id = pc.id WHERE ve.id = ?1",
        EXPENSE_SELECT_COLUMNS
    );
    conn.query_row(&sql, [&id], row_to_expense)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_vehicle_expense(state: State<'_, AppState>, expense: VehicleExpense) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;
    conn.execute(
        "UPDATE vehicle_expenses SET expense_date = ?2, category = ?3, description = ?4, amount = ?5,
         currency = ?6, odometer_km = ?7, quantity = ?8, unit = ?9, unit_price = ?10, location = ?11,
         merchant = ?12, payment_card_id = ?13, next_due_km = ?14, next_due_date = ?15, notes = ?16,
         updated_at = datetime('now')
         WHERE id = ?1",
        rusqlite::params![
            expense.id, expense.expense_date, expense.category, expense.description, expense.amount,
            expense.currency, expense.odometer_km, expense.quantity, expense.unit, expense.unit_price,
            expense.location, expense.merchant, expense.payment_card_id, expense.next_due_km,
            expense.next_due_date, expense.notes
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_vehicle_expense(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;
    // Receipts attached to the expense cascade-delete via the FK.
    conn.execute("DELETE FROM vehicle_expenses WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Aggregate totals for a vehicle's expenses (all-time, current year, and per
/// category), for the fiche's overview.
#[tauri::command]
pub fn get_vehicle_expense_summary(
    state: State<'_, AppState>,
    vehicle_id: String,
) -> Result<VehicleExpenseSummary, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let (total, count): (f64, i64) = conn
        .query_row(
            "SELECT COALESCE(SUM(amount), 0), COUNT(*) FROM vehicle_expenses WHERE vehicle_id = ?1",
            [&vehicle_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    let total_year: f64 = conn
        .query_row(
            "SELECT COALESCE(SUM(amount), 0) FROM vehicle_expenses
             WHERE vehicle_id = ?1 AND substr(expense_date, 1, 4) = strftime('%Y', 'now')",
            [&vehicle_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT category, COALESCE(SUM(amount), 0), COUNT(*) FROM vehicle_expenses
             WHERE vehicle_id = ?1 GROUP BY category ORDER BY SUM(amount) DESC",
        )
        .map_err(|e| e.to_string())?;
    let by_category = stmt
        .query_map([&vehicle_id], |r| {
            Ok(VehicleExpenseCategoryTotal {
                category: r.get(0)?,
                total: r.get(1)?,
                count: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(VehicleExpenseSummary { total, total_year, count, by_category })
}
