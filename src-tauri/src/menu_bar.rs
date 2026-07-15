use tauri::{
    menu::{MenuBuilder, MenuId},
    tray::TrayIconBuilder,
    App,
};

const TRAY_ID: &str = "meetly-menu-bar";
const SHOW_ID: &str = "show-meetly";
const SETTINGS_ID: &str = "open-settings";
const QUIT_ID: &str = "quit-meetly";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MenuAction {
    Show,
    Settings,
    Quit,
}

pub fn setup(app: &App) -> tauri::Result<()> {
    let menu = MenuBuilder::new(app)
        .text(SHOW_ID, "显示 Meetly")
        .text(SETTINGS_ID, "设置...")
        .separator()
        .text(QUIT_ID, "退出 Meetly")
        .build()?;

    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("Meetly")
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| {
            let Some(action) = action_for_id(event.id()) else {
                return;
            };

            let result = match action {
                MenuAction::Show => crate::window::recover_island_window(app),
                MenuAction::Settings => crate::window::open_settings_window(app.clone()),
                MenuAction::Quit => {
                    app.exit(0);
                    Ok(())
                }
            };

            if let Err(error) = result {
                let _ = crate::debug_log::append(&format!(
                    "[menu-bar] action failed action={action:?} error={error}"
                ));
            }
        });

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }

    tray.build(app)?;
    Ok(())
}

fn action_for_id(id: &MenuId) -> Option<MenuAction> {
    match id.as_ref() {
        SHOW_ID => Some(MenuAction::Show),
        SETTINGS_ID => Some(MenuAction::Settings),
        QUIT_ID => Some(MenuAction::Quit),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{action_for_id, MenuAction, QUIT_ID, SETTINGS_ID, SHOW_ID};
    use tauri::menu::MenuId;

    #[test]
    fn maps_known_menu_ids_to_actions() {
        assert_eq!(action_for_id(&MenuId::new(SHOW_ID)), Some(MenuAction::Show));
        assert_eq!(
            action_for_id(&MenuId::new(SETTINGS_ID)),
            Some(MenuAction::Settings)
        );
        assert_eq!(action_for_id(&MenuId::new(QUIT_ID)), Some(MenuAction::Quit));
        assert_eq!(action_for_id(&MenuId::new("unknown")), None);
    }
}
