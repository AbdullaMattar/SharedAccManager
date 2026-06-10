import { Router, type IRouter } from "express";
import { db, productsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/session";
import {
  GetProductParams,
  UpdateProductParams,
  DeleteProductParams,
  CreateProductBody,
  UpdateProductBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/products", requireAuth, async (_req, res): Promise<void> => {
  const products = await db.select().from(productsTable).orderBy(productsTable.createdAt);
  res.json(products);
});

router.post("/products", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [product] = await db.insert(productsTable).values(parsed.data).returning();
  res.status(201).json(product);
});

router.get("/products/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "معرّف غير صالح" });
    return;
  }
  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, params.data.id));
  if (!product) {
    res.status(404).json({ error: "المنتج غير موجود" });
    return;
  }
  res.json(product);
});

router.patch("/products/:id", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "معرّف غير صالح" });
    return;
  }
  const parsed = UpdateProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [product] = await db
    .update(productsTable)
    .set(parsed.data)
    .where(eq(productsTable.id, params.data.id))
    .returning();
  if (!product) {
    res.status(404).json({ error: "المنتج غير موجود" });
    return;
  }
  res.json(product);
});

router.delete("/products/:id", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "معرّف غير صالح" });
    return;
  }
  const [product] = await db.delete(productsTable).where(eq(productsTable.id, params.data.id)).returning();
  if (!product) {
    res.status(404).json({ error: "المنتج غير موجود" });
    return;
  }
  res.sendStatus(204);
});

export default router;
