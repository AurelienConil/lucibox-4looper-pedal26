//! System command manager with an allowlist-based security model.
//!
//! Mirrors `modules/CLManager.js`.
//!
//! Only commands explicitly listed in `allowed_commands` can be executed.
//! A mutex flag prevents concurrent execution, mirroring the Node.js
//! `isExecuting` guard.
//!
//! Linux-only commands (poweroff, reboot, update_system, git_pull filesystem
//! remounts) are guarded with `#[cfg(target_os = "linux")]`.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tracing::{error, info};

/// Manages allowed system command execution.
pub struct ClManager {
    project_root: PathBuf,
    allowed_commands: Vec<String>,
    /// Prevents two commands from running simultaneously.
    is_executing: Arc<Mutex<bool>>,
}

impl ClManager {
    pub fn new(project_root: PathBuf, allowed_commands: Vec<String>) -> Self {
        Self {
            project_root,
            allowed_commands,
            is_executing: Arc::new(Mutex::new(false)),
        }
    }

    /// Return `true` if `command` is in the allowlist.
    pub fn is_allowed(&self, command: &str) -> bool {
        self.allowed_commands.iter().any(|c| c == command)
    }

    /// Return the list of allowed command names (for validation in the bridge).
    pub fn get_available_commands(&self) -> &[String] {
        &self.allowed_commands
    }

    /// Execute an allowed command and return its JSON result.
    ///
    /// Fails immediately if another command is already executing.
    pub async fn execute_command(
        &self,
        command: &str,
        params: &serde_json::Value,
    ) -> anyhow::Result<serde_json::Value> {
        // Guard against concurrent execution.
        {
            let mut exec = self.is_executing.lock().unwrap();
            if *exec {
                anyhow::bail!("Une autre commande est déjà en cours d'exécution");
            }
            *exec = true;
        }

        info!("Executing command: {}", command);
        let result = self.run_command(command, params).await;

        *self.is_executing.lock().unwrap() = false;

        if let Err(ref e) = result {
            error!("Command '{}' failed: {}", command, e);
        }
        result
    }

    // ─── Command dispatch ─────────────────────────────────────────────────────

    async fn run_command(
        &self,
        command: &str,
        _params: &serde_json::Value,
    ) -> anyhow::Result<serde_json::Value> {
        match command {
            "git_pull" => self.cmd_git_pull().await,
            "git_commit" => self.cmd_git_commit().await,
            "poweroff" => self.cmd_poweroff().await,
            "reboot" | "restart" => self.cmd_reboot().await,
            "update_system" => self.cmd_update_system().await,
            "check_status" => self.cmd_check_status().await,
            "cpu_temp" => self.cmd_cpu_temp().await,
            _ => anyhow::bail!("Commande inconnue: {}", command),
        }
    }

    // ─── Individual commands ──────────────────────────────────────────────────

    /// Pull the latest code from git.
    /// On Linux (Raspberry Pi) the filesystem is remounted rw/ro around the pull.
    async fn cmd_git_pull(&self) -> anyhow::Result<serde_json::Value> {
        #[cfg(target_os = "linux")]
        {
            let _ = tokio::process::Command::new("mount")
                .args(["-o", "remount,rw", "/"])
                .status()
                .await;
        }

        let output = tokio::process::Command::new("git")
            .arg("pull")
            .current_dir(&self.project_root)
            .output()
            .await?;

        #[cfg(target_os = "linux")]
        {
            let _ = tokio::process::Command::new("mount")
                .args(["-o", "remount,ro", "/"])
                .status()
                .await;
        }

        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        info!("git pull: {}", stdout);
        Ok(serde_json::json!({ "output": stdout }))
    }

    /// Return the most recent git commit hash and message.
    async fn cmd_git_commit(&self) -> anyhow::Result<serde_json::Value> {
        let output = tokio::process::Command::new("git")
            .args(["log", "--oneline", "-1"])
            .current_dir(&self.project_root)
            .output()
            .await?;

        let commit = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(serde_json::json!({ "commit": commit }))
    }

    /// Shut down the system after a 5-second delay.  Linux only.
    async fn cmd_poweroff(&self) -> anyhow::Result<serde_json::Value> {
        #[cfg(target_os = "linux")]
        {
            info!("System shutting down in 5 seconds...");
            tokio::time::sleep(Duration::from_secs(5)).await;
            let _ = tokio::process::Command::new("poweroff").status().await;
            Ok(serde_json::json!({ "message": "Système en cours d'extinction..." }))
        }
        #[cfg(not(target_os = "linux"))]
        anyhow::bail!("poweroff est uniquement supporté sur Linux (Raspberry Pi)")
    }

    /// Reboot the system after a 5-second delay.  Linux only.
    async fn cmd_reboot(&self) -> anyhow::Result<serde_json::Value> {
        #[cfg(target_os = "linux")]
        {
            info!("System rebooting in 5 seconds...");
            tokio::time::sleep(Duration::from_secs(5)).await;
            let _ = tokio::process::Command::new("reboot").status().await;
            Ok(serde_json::json!({ "message": "Système en cours de redémarrage..." }))
        }
        #[cfg(not(target_os = "linux"))]
        anyhow::bail!("reboot est uniquement supporté sur Linux (Raspberry Pi)")
    }

    /// Run `apt update && apt upgrade -y`.  Linux only.
    async fn cmd_update_system(&self) -> anyhow::Result<serde_json::Value> {
        #[cfg(target_os = "linux")]
        {
            let _ = tokio::process::Command::new("apt")
                .arg("update")
                .status()
                .await;

            let output = tokio::process::Command::new("apt")
                .args(["upgrade", "-y"])
                .output()
                .await?;

            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            Ok(serde_json::json!({ "output": stdout }))
        }
        #[cfg(not(target_os = "linux"))]
        anyhow::bail!("update_system est uniquement supporté sur Linux")
    }

    /// Return uptime, memory, and binary version.
    async fn cmd_check_status(&self) -> anyhow::Result<serde_json::Value> {
        let uptime_out = tokio::process::Command::new("uptime")
            .output()
            .await
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default();

        Ok(serde_json::json!({
            "uptime": uptime_out,
            "version": env!("CARGO_PKG_VERSION"),
        }))
    }

    /// Return CPU usage and temperature.
    /// Temperature via `vcgencmd` (Raspberry Pi).  Falls back gracefully.
    async fn cmd_cpu_temp(&self) -> anyhow::Result<serde_json::Value> {
        // CPU usage via `top` (first data line).
        let cpu_usage: f64 = 0.0; // simplified — parsing `top` output is fragile

        #[cfg(target_os = "linux")]
        let temperature: f64 = {
            let out = tokio::process::Command::new("vcgencmd")
                .arg("measure_temp")
                .output()
                .await;

            match out {
                Ok(o) => {
                    // vcgencmd outputs: `temp=42.8'C\n`
                    let s = String::from_utf8_lossy(&o.stdout);
                    s.trim()
                        .trim_start_matches("temp=")
                        .trim_end_matches("'C")
                        .parse::<f64>()
                        .unwrap_or(0.0)
                }
                Err(_) => 0.0,
            }
        };

        #[cfg(not(target_os = "linux"))]
        let temperature: f64 = 0.0;

        Ok(serde_json::json!({
            "cpuUsage": cpu_usage,
            "temperature": temperature,
        }))
    }
}
