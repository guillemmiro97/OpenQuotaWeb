#[tokio::main]
async fn main() {
    if let Err(error) = openquota_lib::server::run().await {
        eprintln!("OpenQuota web server failed: {error}");
        std::process::exit(1);
    }
}
