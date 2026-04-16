import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./auth/AuthProvider";
import { RequireAuth } from "./auth/RequireAuth";
import { AddToComparePage } from "./compare/AddToComparePage";
import { CompareLegacyRedirect } from "./compare/CompareLegacyRedirect";
import { CompareShell } from "./compare/CompareShell";
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
            <Route path="/layout" element={<CompareShell />}>
              <Route index element={<LayoutStudioPage />} />
              <Route path="jobs/:jobId" element={<LayoutStudioPage />} />
              <Route path="jobs/:jobId/add" element={<AddToComparePage />} />
              <Route path="jobs/:jobId/quote" element={<QuoteSummaryPage />} />
              <Route path="jobs/:jobId/layout" element={<CompareLegacyRedirect target="jobLayout" />} />
              <Route path="jobs/:jobId/options/:optionId/layout" element={<LayoutStudioLegacyRedirect />} />
            </Route>
            <Route path="/compare" element={<CompareLegacyRedirect target="root" />} />
            <Route path="/compare/customers/:customerId" element={<CompareLegacyRedirect target="customer" />} />
            <Route path="/compare/jobs/:jobId" element={<CompareLegacyRedirect target="job" />} />
            <Route path="/compare/jobs/:jobId/add" element={<CompareLegacyRedirect target="jobAdd" />} />
            <Route path="/compare/jobs/:jobId/quote" element={<CompareLegacyRedirect target="jobQuote" />} />
            <Route path="/compare/jobs/:jobId/layout" element={<CompareLegacyRedirect target="jobLayout" />} />
            <Route
              path="/compare/jobs/:jobId/options/:optionId/layout"
              element={<LayoutStudioLegacyRedirect />}
            />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>
);
