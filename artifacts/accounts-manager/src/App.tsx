import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth";
import { AuthGuard } from "@/components/auth-guard";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import Products from "@/pages/products";
import Accounts from "@/pages/accounts";
import Customers from "@/pages/customers";
import CustomerDetail from "@/pages/customer-detail";
import Subscriptions from "@/pages/subscriptions";
import SubscriptionDetail from "@/pages/subscription-detail";
import NewSale from "@/pages/new-sale";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/">
        <AuthGuard>
          <Products />
        </AuthGuard>
      </Route>
      <Route path="/products">
        <AuthGuard>
          <Products />
        </AuthGuard>
      </Route>
      <Route path="/accounts">
        <AuthGuard>
          <Accounts />
        </AuthGuard>
      </Route>
      <Route path="/customers/:id">
        {(params) => <AuthGuard><CustomerDetail id={Number(params.id)} /></AuthGuard>}
      </Route>
      <Route path="/customers"><AuthGuard><Customers /></AuthGuard></Route>
      <Route path="/subscriptions/:id">
        {(params) => <AuthGuard><SubscriptionDetail id={Number(params.id)} /></AuthGuard>}
      </Route>
      <Route path="/subscriptions"><AuthGuard><Subscriptions /></AuthGuard></Route>
      <Route path="/sale/new"><AuthGuard><NewSale /></AuthGuard></Route>
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
