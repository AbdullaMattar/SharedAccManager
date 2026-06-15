import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { repairOrphanedAccountProducts } from "../../../../../lib/db/src/repair";

describe("repairOrphanedAccountProducts", () => {
  it("preserves orphaned accounts by recreating their missing product", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(`
      create table products (
        id integer primary key,
        org_id integer not null,
        name text not null,
        service text not null,
        default_capacity integer not null,
        default_duration_days integer not null,
        default_price real not null,
        notes text
      );
      create table accounts (
        id integer primary key,
        org_id integer not null,
        product_id integer not null references products(id)
      );
      pragma foreign_keys = off;
      insert into accounts (id, org_id, product_id) values (201, 7, 42);
      pragma foreign_keys = on;
    `);

    expect(repairOrphanedAccountProducts(sqlite)).toBe(1);
    expect(sqlite.prepare("select id, org_id, service from products").get()).toEqual({
      id: 42,
      org_id: 7,
      service: "Recovered",
    });
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);

    sqlite.close();
  });
});
