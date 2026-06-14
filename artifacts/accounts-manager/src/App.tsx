import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth";
import { AuthGuard } from "@/components/auth-guard";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import About from "@/pages/about";
import Inventory from "@/pages/inventory";
import Customers from "@/pages/customers";
import CustomerDetail from "@/pages/customer-detail";
import Subscriptions from "@/pages/subscriptions";
import SubscriptionDetail from "@/pages/subscription-detail";
import NewSale from "@/pages/new-sale";
import Dashboard from "@/pages/dashboard";
import Expiring from "@/pages/expiring";
import Settings from "@/pages/settings";
import Users from "@/pages/users";
import Audit from "@/pages/audit";
import { AdminGuard } from "@/components/admin-guard";
import { OrgGuard } from "@/components/org-guard";
import { SuperadminGuard } from "@/components/superadmin-guard";
import PlatformPage from "@/pages/platform";
import DataSecurity from "@/pages/data-security";
import { useAuth } from "@/lib/auth";

const queryClient = new QueryClient();

function Router() {
  const { user } = useAuth();
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/about" component={About} />
      <Route path="/">
        <AuthGuard>
          {user?.role === "superadmin" ? <PlatformPage /> : <OrgGuard><Dashboard /></OrgGuard>}
        </AuthGuard>
      </Route>
      <Route path="/inventory">
        <AuthGuard>
          <OrgGuard><Inventory /></OrgGuard>
        </AuthGuard>
      </Route>
      <Route path="/products">
        <AuthGuard>
          <OrgGuard><Inventory /></OrgGuard>
        </AuthGuard>
      </Route>
      <Route path="/accounts">
        <AuthGuard>
          <OrgGuard><Inventory /></OrgGuard>
        </AuthGuard>
      </Route>
      <Route path="/customers/:id">
        {(params) => <AuthGuard><OrgGuard><CustomerDetail id={Number(params.id)} /></OrgGuard></AuthGuard>}
      </Route>
      <Route path="/customers"><AuthGuard><OrgGuard><Customers /></OrgGuard></AuthGuard></Route>
      <Route path="/subscriptions/:id">
        {(params) => <AuthGuard><OrgGuard><SubscriptionDetail id={Number(params.id)} /></OrgGuard></AuthGuard>}
      </Route>
      <Route path="/subscriptions"><AuthGuard><OrgGuard><Subscriptions /></OrgGuard></AuthGuard></Route>
      <Route path="/sale/new"><AuthGuard><OrgGuard><NewSale /></OrgGuard></AuthGuard></Route>
      <Route path="/expiring"><AuthGuard><OrgGuard><Expiring /></OrgGuard></AuthGuard></Route>
      <Route path="/admin/settings"><AuthGuard><OrgGuard><AdminGuard><Settings /></AdminGuard></OrgGuard></AuthGuard></Route>
      <Route path="/admin/users"><AuthGuard><OrgGuard><AdminGuard><Users /></AdminGuard></OrgGuard></AuthGuard></Route>
      <Route path="/admin/audit"><AuthGuard><OrgGuard><AdminGuard><Audit /></AdminGuard></OrgGuard></AuthGuard></Route>
      <Route path="/admin/data-security"><AuthGuard><OrgGuard><AdminGuard><DataSecurity /></AdminGuard></OrgGuard></AuthGuard></Route>
      <Route path="/platform"><AuthGuard><SuperadminGuard><PlatformPage /></SuperadminGuard></AuthGuard></Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
