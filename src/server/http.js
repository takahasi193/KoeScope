export function asyncHandler(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

export function registerErrorHandler(app) {
  app.use((error, _req, res, _next) => {
    const statusCode = error.statusCode || error.status || 500;
    if (statusCode >= 500) console.error(error);
    res.status(statusCode).json({
      error: error.message || "服务器内部错误。",
    });
  });
}
