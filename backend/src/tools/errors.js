/**
 * A tool failure the model is expected to read and recover from.
 * `hint` is deliberately actionable — models recover from structured errors
 * and spiral on opaque ones.
 */
class ToolError extends Error {
  constructor(message, { code = 'TOOL_ERROR', status = 500, hint } = {}) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.status = status;
    this.hint = hint;
  }

  toResult() {
    return {
      success: false,
      error: this.message,
      code: this.code,
      ...(this.hint ? { hint: this.hint } : {})
    };
  }
}

const notFound = (msg, hint) => new ToolError(msg, { code: 'ENOENT', status: 404, hint });
const badRequest = (msg, hint) => new ToolError(msg, { code: 'EINVAL', status: 400, hint });
const conflict = (msg, hint) => new ToolError(msg, { code: 'ECONFLICT', status: 409, hint });

module.exports = { ToolError, notFound, badRequest, conflict };
