import { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodTypeAny } from 'zod';
import { validationError } from '../utils/app-error';

interface ValidationSchemas {
  body?: ZodTypeAny;
  params?: ZodTypeAny;
  query?: ZodTypeAny;
}

/**
 * Parses each request part with its Zod schema and replaces the raw values with
 * the parsed (coerced, trimmed, defaulted) result. Unknown keys are stripped by
 * Zod's default object behaviour.
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const issues: Array<{ location: string; path: string; message: string }> = [];

    const parts = ['params', 'query', 'body'] as const;

    for (const part of parts) {
      const schema = schemas[part];
      if (!schema) continue;

      const result = schema.safeParse(req[part]);

      if (!result.success) {
        for (const issue of result.error.issues) {
          issues.push({
            location: part,
            path: issue.path.join('.'),
            message: issue.message,
          });
        }
        continue;
      }

      if (part === 'query') {
        req.query = result.data as Request['query'];
      } else {
        req[part] = result.data;
      }
    }

    if (issues.length > 0) {
      next(validationError('Request validation failed', issues));
      return;
    }

    next();
  };
}
