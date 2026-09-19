// Uniform error shape for every route: { error: message, fields?: {...} }.
// Business-rule errors are thrown as plain Error objects by the services layer (matching the
// frontend mock's convention) and turned into 400s here rather than 500s.
export function errorHandler(err, req, res, _next) {
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err.message);
  const status = err.status || 400;
  const body = { error: err.message || "Something went wrong." };
  if (err.fields) body.fields = err.fields;
  res.status(status).json(body);
}

export function notFound(req, res) {
  res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}` });
}

// Wraps an async route handler so a rejected promise reaches errorHandler instead of hanging.
export const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
