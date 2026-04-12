import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./auth/AuthProvider";
import { RequireAuth } from "./auth/RequireAuth";
import { AddToComparePage } from "./compare/AddToComparePage";
import { CompareLandingPage } from "./compare/CompareLandingPage";
import { CompareShell } from "./compare/CompareShell";
import { CustomerDetailPage } from "./compare/CustomerDetailPage";
import { JobDetailPage } from "./compare/JobDetailPage";
import { LayoutStudioLegacyRedirect } from "./compare/LayoutStudioLegacyRedirect";
import { LayoutStudioPage } from "./compare/LayoutStudioPage";
import { PublicLayoutQuotePage } from "./compare/PublicLayoutQuotePage";
import { QuoteSummaryPage } from "./compare/QuoteSummaryPage";
import "./styles/global.css";

const el = document.getElementById("root");
if (!el) throw new Error("Root element #root not found");

createRoot(el).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/share/layout-quote/:shareId" element={<PublicLayoutQuotePage />} />
          <Route element={<RequireAuth />}>
            <Route path="/" element={<App />} />
            <Route path="/compare" element={<CompareShell />}>
              <Route index element={<CompareLandingPage />} />
              <Route path="customers/:customerId" element={<CustomerDetailPage />} />
              <Route path="jobs/:jobId" element={<JobDetailPage />} />
              <Route path="jobs/:jobId/add" element={<AddToComparePage />} />
              <Route path="jobs/:jobId/quote" element={<QuoteSummaryPage />} />
              <Route path="jobs/:jobId/layout" element={<LayoutStudioPage />} />
              <Route path="jobs/:jobId/options/:optionId/layout" element={<LayoutStudioLegacyRedirect />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>
);
