mod commands;
mod crypto;
mod db;
mod storage;
mod util;

use commands::auth::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data directory");
            std::fs::create_dir_all(app_data_dir.join("vaults")).ok();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::auth::check_vault_exists,
            commands::auth::create_vault,
            commands::auth::unlock_vault,
            commands::auth::lock_vault,
            commands::auth::list_vaults,
            commands::auth::switch_vault,
            commands::auth::get_active_vault_location,
            commands::auth::open_active_vault_folder,
            commands::items::get_items,
            commands::items::create_item,
            commands::items::update_item,
            commands::items::delete_item,
            commands::items::create_order_with_items,
            commands::items::link_items_to_order,
            commands::items::unlink_item_from_order,
            commands::merchants::get_merchants,
            commands::merchants::create_merchant,
            commands::merchants::update_merchant,
            commands::merchants::delete_merchant,
            commands::locations::get_locations,
            commands::locations::create_location,
            commands::locations::update_location,
            commands::locations::delete_location,
            commands::cards::get_cards,
            commands::cards::create_card,
            commands::cards::update_card,
            commands::cards::delete_card,
            commands::warranties::get_warranties,
            commands::warranties::create_warranty,
            commands::warranties::update_warranty,
            commands::warranties::delete_warranty,
            commands::warranties::get_expiring_warranties,
            commands::attachments::get_attachments,
            commands::attachments::get_subscription_attachments,
            commands::attachments::add_attachment,
            commands::attachments::add_subscription_attachment,
            commands::attachments::add_text_attachment,
            commands::attachments::delete_attachment,
            commands::attachments::export_attachment,
            commands::attachments::get_attachment_data,
            commands::pending_invoices::list_pending_invoices,
            commands::pending_invoices::add_pending_invoice,
            commands::pending_invoices::add_pending_invoices_batch,
            commands::pending_invoices::update_pending_invoice,
            commands::pending_invoices::delete_pending_invoice,
            commands::pending_invoices::get_pending_invoice_data,
            commands::pending_invoices::attach_pending_invoice_to_item,
            commands::filename_templates::list_filename_templates,
            commands::filename_templates::set_filename_template,
            commands::filename_templates::reset_filename_template,
            commands::reminders::get_upcoming_reminders,
            commands::subscriptions::get_subscriptions,
            commands::subscriptions::get_subscription,
            commands::subscriptions::create_subscription,
            commands::subscriptions::update_subscription,
            commands::subscriptions::delete_subscription,
            commands::subscriptions::get_upcoming_renewals,
            commands::subscriptions::roll_forward_due_subscriptions,
            commands::subscriptions::mark_renewed,
            commands::subscriptions::get_subscription_payments,
            commands::subscriptions::log_subscription_payment,
            commands::subscriptions::delete_subscription_payment,
            commands::subscriptions::get_subscription_members,
            commands::subscriptions::add_subscription_member,
            commands::subscriptions::update_subscription_member,
            commands::subscriptions::delete_subscription_member,
            commands::backup::backup_vault,
            commands::backup::inspect_backup,
            commands::backup::restore_backup,
            commands::backup::export_items_csv,
            commands::backup::get_stats,
            commands::files::write_text_file,
            commands::files::read_text_file,
            commands::files::read_binary_file_base64,
            commands::ai::ai_extract_receipt,
            commands::ai::ai_test_connection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running TrackBuy");
}
