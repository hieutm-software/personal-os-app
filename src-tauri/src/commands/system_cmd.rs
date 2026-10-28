use crate::core::error::AppError;
use serde::Serialize;
use std::sync::Mutex;
use std::time::Instant;
use sysinfo::{Disks, Networks};

#[derive(Debug, Serialize, Clone)]
pub struct SystemMetrics {
    pub storage_percent: u8,
    pub storage_used_bytes: u64,
    pub storage_total_bytes: u64,
    pub download_bytes_per_sec: u64,
    pub upload_bytes_per_sec: u64,
    pub is_network_connected: bool,
}

pub struct SystemMonitorState {
    pub networks: Networks,
    pub disks: Disks,
    pub last_network_check: Instant,
    pub last_disk_check: Instant,
    pub cached_storage_percent: u8,
    pub cached_storage_used_bytes: u64,
    pub cached_storage_total_bytes: u64,
}

impl Default for SystemMonitorState {
    fn default() -> Self {
        let networks = Networks::new_with_refreshed_list();
        let disks = Disks::new_with_refreshed_list();
        let mut state = Self {
            networks,
            disks,
            last_network_check: Instant::now(),
            last_disk_check: Instant::now(),
            cached_storage_percent: 0,
            cached_storage_used_bytes: 0,
            cached_storage_total_bytes: 0,
        };
        state.update_disks();
        state
    }
}

impl SystemMonitorState {
    fn update_disks(&mut self) {
        self.disks.refresh(true);

        let mut primary_total: u64 = 0;
        let mut primary_available: u64 = 0;

        for disk in self.disks.list() {
            let total = disk.total_space();
            let available = disk.available_space();
            if total > primary_total {
                primary_total = total;
                primary_available = available;
            }
        }

        if primary_total > 0 {
            let used = primary_total.saturating_sub(primary_available);
            self.cached_storage_used_bytes = used;
            self.cached_storage_total_bytes = primary_total;
            self.cached_storage_percent = ((used as f64 / primary_total as f64) * 100.0).round().clamp(0.0, 100.0) as u8;
        }
    }
}

#[tauri::command]
pub fn get_system_metrics(
    state: tauri::State<'_, Mutex<SystemMonitorState>>,
) -> Result<SystemMetrics, AppError> {
    let mut monitor = state.lock().map_err(|e| AppError::Unknown(e.to_string()))?;

    let now = Instant::now();
    let elapsed = now.duration_since(monitor.last_network_check).as_secs_f64();

    monitor.networks.refresh(true);

    let mut rx_bytes_sum: u64 = 0;
    let mut tx_bytes_sum: u64 = 0;
    let mut has_active_interface = false;

    for net in monitor.networks.values() {
        let rx = net.received();
        let tx = net.transmitted();
        rx_bytes_sum = rx_bytes_sum.saturating_add(rx);
        tx_bytes_sum = tx_bytes_sum.saturating_add(tx);
        if rx > 0 || tx > 0 {
            has_active_interface = true;
        }
    }

    let download_speed = if elapsed > 0.1 {
        ((rx_bytes_sum as f64) / elapsed).round() as u64
    } else {
        0
    };

    let upload_speed = if elapsed > 0.1 {
        ((tx_bytes_sum as f64) / elapsed).round() as u64
    } else {
        0
    };

    monitor.last_network_check = now;

    if now.duration_since(monitor.last_disk_check).as_secs() >= 10 {
        monitor.update_disks();
        monitor.last_disk_check = now;
    }

    Ok(SystemMetrics {
        storage_percent: monitor.cached_storage_percent,
        storage_used_bytes: monitor.cached_storage_used_bytes,
        storage_total_bytes: monitor.cached_storage_total_bytes,
        download_bytes_per_sec: download_speed,
        upload_bytes_per_sec: upload_speed,
        is_network_connected: has_active_interface || !monitor.networks.is_empty(),
    })
}
