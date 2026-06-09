import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/ThemeProvider";
import Layout from "@/components/Layout";
import DashboardPage from "@/pages/DashboardPage";
import TemplatesPage from "@/pages/TemplatesPage";
import BulkUpdatePage from "@/pages/BulkUpdatePage";
import PhotosPage from "@/pages/PhotosPage";
import EZCarePage from "@/pages/EZCarePage";
import JobsPage from "@/pages/JobsPage";
import LoginPage from "@/pages/LoginPage";

function AppContent() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["/api/auth/status"],
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const authenticated = (data as any)?.authenticated;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0f1923] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#14b8a6] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!authenticated) {
    return (
      <LoginPage
        onLogin={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/auth/status"] });
          refetch();
        }}
      />
    );
  }

  return (
    <Router hook={useHashLocation}>
      <Layout>
        <Switch>
          <Route path="/" component={DashboardPage} />
          <Route path="/templates" component={TemplatesPage} />
          <Route path="/bulk-update" component={BulkUpdatePage} />
          <Route path="/photos" component={PhotosPage} />
          <Route path="/ezcare" component={EZCarePage} />
          <Route path="/jobs" component={JobsPage} />
        </Switch>
      </Layout>
    </Router>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AppContent />
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
