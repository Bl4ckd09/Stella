// Minimal ambient types for pg-copy-streams (no official @types package).
// copyFrom() returns an object that is both a Writable stream and a pg
// Submittable, so `client.query(copyFrom(...))` returns the same stream.
declare module "pg-copy-streams" {
  import { Writable } from "node:stream";
  import type { Submittable, Connection } from "pg";

  export interface CopyStreamQuery extends Writable, Submittable {
    submit(connection: Connection): void;
  }
  export function from(text: string): CopyStreamQuery;
  export function to(text: string): NodeJS.ReadableStream & Submittable;
}
