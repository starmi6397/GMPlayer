pub mod algorithms;
pub mod shared;

#[cfg(not(mobile))]
pub mod desktop;

#[cfg(mobile)]
pub mod mobile;

#[cfg(all(
    not(windows),
    not(target_os = "android"),
    not(target_os = "macos"),
    not(target_os = "freebsd"),
    not(target_os = "openbsd"),
    not(target_os = "illumos"),
    not(all(target_env = "musl", target_pointer_width = "32")),
    not(target_arch = "riscv64")
))]
use tikv_jemallocator;

#[cfg(all(
    not(windows),
    not(target_os = "android"),
    not(target_os = "macos"),
    not(target_os = "freebsd"),
    not(target_os = "openbsd"),
    not(target_os = "illumos"),
    not(all(target_env = "musl", target_pointer_width = "32")),
    not(target_arch = "riscv64")
))]
#[global_allocator]
static GLOBAL: tikv_jemallocator::Jemalloc = tikv_jemallocator::Jemalloc;

#[cfg(windows)]
#[global_allocator]
static GLOBAL: rpmalloc::RpMalloc = rpmalloc::RpMalloc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(not(mobile))]
    desktop::run();

    #[cfg(mobile)]
    mobile::run();
}
