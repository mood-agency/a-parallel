#[macro_use]
extern crate napi_derive;

mod status_summary;
mod diff_summary;
mod branch;
mod log;

pub use status_summary::*;
pub use diff_summary::*;
pub use branch::*;
pub use log::*;

/// Simple ping function to verify the native module loads correctly.
#[napi]
pub fn ping() -> String {
  "pong".to_string()
}
