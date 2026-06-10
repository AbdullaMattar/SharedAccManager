import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import productsRouter from "./products";
import accountsRouter from "./accounts";
import statsRouter from "./stats";
import customersRouter from "./customers";
import salesRouter from "./sales";
import subscriptionsRouter from "./subscriptions";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(productsRouter);
router.use(accountsRouter);
router.use(statsRouter);
router.use(customersRouter);
router.use(salesRouter);
router.use(subscriptionsRouter);

export default router;
