use std::env;
use std::fs;
use std::path::Path;

fn main() {
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();
    let workspace_root = Path::new(&manifest_dir).parent().unwrap();
    let idl_path = workspace_root.join("target/idl/market_state.json");

    if !idl_path.exists() {
        println!("cargo:warning=market_state.json IDL not found at {} — using default discriminators (run `anchor build` before `cargo build`)", idl_path.display());
        println!("cargo:rustc-env=IDISC_UPDATE_MARKET_STATE=195,34,135,147,8,27,159,18");
        return;
    }

    let idl_content = match fs::read_to_string(&idl_path) {
        Ok(c) => c,
        Err(e) => {
            println!("cargo:warning=Failed to read IDL at {}: {} — using default discriminators", idl_path.display(), e);
            println!("cargo:rustc-env=IDISC_UPDATE_MARKET_STATE=195,34,135,147,8,27,159,18");
            return;
        }
    };

    let idl: serde_json::Value = match serde_json::from_str(&idl_content) {
        Ok(v) => v,
        Err(e) => {
            println!("cargo:warning=Failed to parse IDL JSON: {} — using default discriminators", e);
            println!("cargo:rustc-env=IDISC_UPDATE_MARKET_STATE=195,34,135,147,8,27,159,18");
            return;
        }
    };

    if let Some(instructions) = idl["instructions"].as_array() {
        for instr in instructions {
            if let Some(name) = instr["name"].as_str() {
                if let Some(disc) = instr["discriminator"].as_array() {
                    let values: Vec<String> = disc
                        .iter()
                        .filter_map(|v| v.as_u64().map(|n| n as u8))
                        .map(|b| b.to_string())
                        .collect();
                    if values.len() == 8 {
                        let env_var_name = format!("IDISC_{}", name.to_uppercase().replace('-', "_"));
                        let env_value = values.join(",");
                        println!("cargo:rustc-env={}={}", env_var_name, env_value);
                    }
                }
            }
        }
    }

    println!("cargo:rerun-if-changed={}", idl_path.display());
}
