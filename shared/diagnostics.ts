let verboseDiagnostics = false;
export function setVerboseDiagnostics(value: boolean): void { verboseDiagnostics = value === true; }
export function diagnosticsVerbose(): boolean { return verboseDiagnostics; }

/** Detailed diagnostics may contain notification content; evaluate only after opt-in. */
export function createDiagnosticLogger(write: (line: string) => unknown, verbose: () => boolean) {
    return (summary: string, detail?: () => string): void => {
        let line = summary;
        try {
            if (detail && verbose()) line = detail();
        } catch { /* Keep the safe summary when a diagnostic value cannot be read. */ }
        try {
            void Promise.resolve(write(line)).catch(() => {});
        } catch { /* Diagnostics must never interrupt notification delivery. */ }
    };
}
