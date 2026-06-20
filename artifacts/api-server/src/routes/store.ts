import { Router, type IRouter } from "express";
import { storeSlugParamsSchema } from "@workspace/db";
import { getPublicStoreBySlug } from "../lib/store-settings";

const router: IRouter = Router();

router.get("/store/:slug", async (req, res): Promise<void> => {
  const params = storeSlugParamsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "المتجر غير موجود" });
    return;
  }

  const store = await getPublicStoreBySlug(params.data.slug);
  if (!store) {
    res.status(404).json({ error: "المتجر غير موجود" });
    return;
  }

  res.json(store);
});

export default router;
