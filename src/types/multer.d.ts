/**
 * Type declarations for @koa/multer
 *
 * These types extend the Express.Multer namespace to work with Koa.
 */

declare namespace Express {
  namespace Multer {
    interface File {
      /** Field name specified in the form */
      fieldname: string
      /** Name of the file on the user's computer */
      originalname: string
      /** Encoding type of the file */
      encoding: string
      /** Mime type of the file */
      mimetype: string
      /** Size of the file in bytes */
      size: number
      /** The folder to which the file has been saved (DiskStorage) */
      destination: string
      /** The name of the file within the destination (DiskStorage) */
      filename: string
      /** Location of the uploaded file (DiskStorage) */
      path: string
      /** A Buffer of the entire file (MemoryStorage) */
      buffer: Buffer
    }
  }
}

declare module '@koa/multer' {
  import type { Middleware } from 'koa'

  interface MulterOptions {
    dest?: string
    storage?: StorageEngine
    limits?: {
      fieldNameSize?: number
      fieldSize?: number
      fields?: number
      fileSize?: number
      files?: number
      parts?: number
      headerPairs?: number
    }
    fileFilter?(
      req: unknown,
      file: Express.Multer.File,
      callback: (error: Error | null, acceptFile: boolean) => void,
    ): void
  }

  interface StorageEngine {
    _handleFile(
      req: unknown,
      file: Express.Multer.File,
      callback: (error: unknown, info?: Partial<Express.Multer.File>) => void,
    ): void
    _removeFile(
      req: unknown,
      file: Express.Multer.File,
      callback: (error: unknown) => void,
    ): void
  }

  interface Multer {
    single(field: string): Middleware
    array(field: string, maxCount?: number): Middleware
    fields(fields: Array<{ name: string; maxCount?: number }>): Middleware
    none(): Middleware
  }

  function multer(options?: MulterOptions): Multer

  namespace multer {
    function memoryStorage(): StorageEngine
    function diskStorage(options: {
      destination?: string | ((req: unknown, file: Express.Multer.File, callback: (error: unknown, destination: string) => void) => void)
      filename?: (req: unknown, file: Express.Multer.File, callback: (error: unknown, filename: string) => void) => void
    }): StorageEngine
  }

  export = multer
}
