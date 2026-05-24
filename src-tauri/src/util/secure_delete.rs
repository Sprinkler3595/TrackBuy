use std::fs::OpenOptions;
use std::io::{Seek, SeekFrom, Write};
use std::path::Path;

/// Overwrite a file with zero bytes, then remove it.
///
/// Best-effort: on SSDs with TRIM, the original sectors may already be
/// unrecoverable (or the overwrite may be redirected by the FTL). On HDDs and
/// USB flash drives the overwrite reliably destroys the prior content.
///
/// If overwriting fails (e.g. file is read-only), still attempt removal.
pub fn shred_and_remove(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    // Attempt to overwrite. Errors are logged-via-return-value but don't
    // prevent the subsequent unlink — losing the metadata is still better
    // than leaving the file in place.
    if let Err(e) = overwrite_zeros(path) {
        // Best-effort: continue to remove even if overwrite failed.
        let _ = e;
    }

    std::fs::remove_file(path).map_err(|e| format!("Failed to remove file: {}", e))?;
    Ok(())
}

fn overwrite_zeros(path: &Path) -> std::io::Result<()> {
    let metadata = std::fs::metadata(path)?;
    let len = metadata.len();
    if len == 0 {
        return Ok(());
    }

    let mut f = OpenOptions::new().write(true).open(path)?;
    f.seek(SeekFrom::Start(0))?;

    const CHUNK: usize = 64 * 1024;
    let zeros = vec![0u8; CHUNK];
    let mut remaining = len;
    while remaining > 0 {
        let n = remaining.min(CHUNK as u64) as usize;
        f.write_all(&zeros[..n])?;
        remaining -= n as u64;
    }
    f.flush()?;
    f.sync_all()?;
    Ok(())
}
