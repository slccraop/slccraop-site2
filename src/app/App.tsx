import { Route, Routes } from 'react-router-dom';
import { ContentPage } from '../features/pages/ContentPage';
import { MethodologyPage } from '../features/pages/MethodologyPage';
import { NotFoundPage } from '../features/pages/NotFoundPage';
import { CasePage } from '../features/public-ledger/CasePage';
import { HomePage } from '../features/public-ledger/HomePage';
import { ReferralPage } from '../features/referral/ReferralPage';
import { CorrectionPage } from '../features/report/CorrectionPage';
import { EvidencePage } from '../features/report/EvidencePage';
import { ReportPage } from '../features/report/ReportPage';
import { WithdrawPage } from '../features/report/WithdrawPage';
import { Layout } from './Layout';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="how-it-works" element={<ContentPage k="howItWorks" />} />
        <Route path="methodology" element={<MethodologyPage />} />
        <Route path="referral" element={<ReferralPage />} />
        <Route path="report" element={<ReportPage />} />
        <Route path="add-evidence" element={<EvidencePage />} />
        <Route path="withdraw" element={<WithdrawPage />} />
        <Route path="correction" element={<CorrectionPage />} />
        <Route path="about" element={<ContentPage k="about" />} />
        <Route path="privacy" element={<ContentPage k="privacy" />} />
        <Route path="terms" element={<ContentPage k="terms" />} />
        <Route path="consent" element={<ContentPage k="consent" />} />
        <Route path="contact" element={<ContentPage k="contact" />} />
        <Route path="case/:caseId" element={<CasePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
