//! Pure Data process manager stub.
//!
//! Mirrors `modules/PdManager.js`.
//! The Node.js original is itself a stub — PD launch is not yet implemented.

use tracing::info;
use tokio::process::Child;

pub struct PdManager {
    process: Option<Child>,
}

impl PdManager {
    pub fn new() -> Self {
        Self { process: None }
    }

    /// Launch a Pure Data program at the given path.
    pub async fn start(&mut self, program_path: &str) -> anyhow::Result<()> {
        let child = tokio::process::Command::new("pd")
            .arg(program_path)
            .spawn()?;
        info!("PD started: {} (pid {})", program_path, child.id().unwrap_or(0));
        self.process = Some(child);
        Ok(())
    }

    /// Kill the running Pure Data process.
    pub async fn stop(&mut self) {
        if let Some(mut child) = self.process.take() {
            let _ = child.kill().await;
            info!("PD stopped");
        }
    }

    pub fn is_running(&self) -> bool {
        self.process.is_some()
    }
}
