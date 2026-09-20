// Imported first by test files that do not set their own environment. Sends LLM usage counters to a throwaway file, so
// running the tests can never fill in the real data/usage.json (which drives the daily cap and the dashboard).
import os from "os";
import path from "path";

process.env.USAGE_FILE = path.join(os.tmpdir(), `usage-test-${process.pid}.json`);
// These files test the engines' wiring, not retrieval quality, so the local embedding model is switched off: loading it (about
// 130 MB) on the first retrieval could take longer than a test's timeout when many test files run at once.
process.env.EMBEDDINGS = "off";
