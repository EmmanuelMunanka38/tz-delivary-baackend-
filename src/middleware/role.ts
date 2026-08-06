import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';

const role = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.userRole || !roles.includes(req.userRole)) {
      res.status(403).json({
        success: false,
        message: 'Access denied. Insufficient permissions.',
      });
      return;
    }
    next();
  };
};

export default role;
