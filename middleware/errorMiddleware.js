const errorHandler = (err, req, res, next) => {
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  res.status(statusCode).json({
    success: false,
    message: process.env.NODE_ENV === 'production'
      ? 'An unexpected error occurred. Please try again later.'
      : (err.message || 'Internal Server Error'),
    code: 'INTERNAL_SERVER_ERROR',
    // Never expose stack traces in production
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
};

const notFound = (req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  res.status(404);
  next(error);
};

module.exports = { errorHandler, notFound };
