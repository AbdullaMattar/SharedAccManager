import type Database from "better-sqlite3";

interface MissingProduct {
  productId: number;
  orgId: number;
}

export function repairOrphanedAccountProducts(sqlite: Database.Database): number {
  const ambiguous = sqlite.prepare(`
    select accounts.product_id as productId, count(distinct accounts.org_id) as orgCount
    from accounts
    left join products on products.id = accounts.product_id
    where products.id is null
    group by accounts.product_id
    having count(distinct accounts.org_id) > 1
  `).all() as Array<{ productId: number; orgCount: number }>;

  if (ambiguous.length > 0) {
    throw new Error(`Cannot repair orphaned accounts across organizations: ${JSON.stringify(ambiguous)}`);
  }

  const missing = sqlite.prepare(`
    select distinct accounts.product_id as productId, accounts.org_id as orgId
    from accounts
    left join products on products.id = accounts.product_id
    where products.id is null
  `).all() as MissingProduct[];

  if (missing.length === 0) return 0;

  const insert = sqlite.prepare(`
    insert into products (
      id, org_id, name, service, default_capacity, default_duration_days, default_price, notes
    ) values (
      @productId, @orgId, @name, 'Recovered', 1, 30, 0, @notes
    )
  `);

  sqlite.transaction(() => {
    for (const product of missing) {
      insert.run({
        ...product,
        name: `Recovered product #${product.productId}`,
        notes: "Automatically recreated because linked accounts referenced a missing product.",
      });
    }
  })();

  return missing.length;
}
