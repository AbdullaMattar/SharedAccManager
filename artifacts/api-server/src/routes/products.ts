import { Router, type IRouter } from "express";
import { accountsTable, db, productsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "../lib/session";
import { requireOrgUser } from "../lib/rbac";
import { getRequestUser } from "../lib/request-user";
import {
  CreateProductBody,
  DeleteProductParams,
  GetProductParams,
  UpdateProductBody,
  UpdateProductParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.use("/products", requireAuth, requireOrgUser);

router.get("/products", async (req, res): Promise<void> => {
  const user = getRequestUser(req);
  const products = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.orgId, user.orgId!))
    .orderBy(productsTable.createdAt);
  res.json(products);
});

router.post("/products", async (req, res): Promise<void> => {
  const parsed = CreateProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = getRequestUser(req);
  const [product] = await db
    .insert(productsTable)
    .values({ ...parsed.data, orgId: user.orgId! })
    .returning();
  res.status(201).json(product);
});

router.get("/products/:id", async (req, res): Promise<void> => {
  const params = GetProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "معرف غير صالح" });
    return;
  }
  const user = getRequestUser(req);
  const [product] = await db
    .select()
    .from(productsTable)
    .where(and(eq(productsTable.id, params.data.id), eq(productsTable.orgId, user.orgId!)));
  if (!product) {
    res.status(404).json({ error: "المنتج غير موجود" });
    return;
  }
  res.json(product);
});

router.patch("/products/:id", async (req, res): Promise<void> => {
  const params = UpdateProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "معرف غير صالح" });
    return;
  }
  const parsed = UpdateProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = getRequestUser(req);
  const [product] = await db
    .update(productsTable)
    .set(parsed.data)
    .where(and(eq(productsTable.id, params.data.id), eq(productsTable.orgId, user.orgId!)))
    .returning();
  if (!product) {
    res.status(404).json({ error: "المنتج غير موجود" });
    return;
  }
  res.json(product);
});

router.delete("/products/:id", async (req, res): Promise<void> => {
  const params = DeleteProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "معرف غير صالح" });
    return;
  }
  const user = getRequestUser(req);
  const linkedAccount = await db
    .select({ id: accountsTable.id })
    .from(accountsTable)
    .where(and(eq(accountsTable.productId, params.data.id), eq(accountsTable.orgId, user.orgId!)))
    .get();
  if (linkedAccount) {
    res.status(409).json({ error: "لا يمكن حذف المنتج لوجود حسابات مرتبطة به" });
    return;
  }
  const [product] = await db
    .delete(productsTable)
    .where(and(eq(productsTable.id, params.data.id), eq(productsTable.orgId, user.orgId!)))
    .returning();
  if (!product) {
    res.status(404).json({ error: "المنتج غير موجود" });
    return;
  }
  res.sendStatus(204);
});

export default router;
