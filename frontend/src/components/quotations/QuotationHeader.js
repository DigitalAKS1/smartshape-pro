import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../ui/button';
import { Download, Edit2, ArrowLeft, Printer, GitBranch } from 'lucide-react';
import { quotations } from '../../lib/api';

export default function QuotationHeader({ quot, id, creatingVersion, onNewVersion }) {
  const navigate = useNavigate();

  return (
    <div className="no-print bg-[var(--bg-primary)] border-b border-[var(--border-color)] px-6 py-3 flex items-center justify-between sticky top-0 z-50">
      <div className="flex items-center gap-3">
        <Button onClick={() => navigate('/quotations')} variant="ghost" size="sm" className="text-[var(--text-secondary)]">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <span className="text-[var(--text-primary)] font-medium">{quot.quote_number}</span>
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
          quot.quotation_status === 'confirmed' ? 'bg-green-500/20 text-green-300' :
          quot.quotation_status === 'sent'      ? 'bg-blue-500/20  text-blue-300'  :
          'bg-yellow-500/20 text-yellow-300'
        }`}>{quot.quotation_status}</span>
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={onNewVersion} disabled={creatingVersion} variant="outline" size="sm"
          className="border-blue-500/50 text-blue-400 hover:bg-blue-500/10">
          <GitBranch className="mr-1.5 h-3 w-3" />
          {creatingVersion ? 'Creating…' : `New Version${quot?.version ? ` (V${quot.version})` : ''}`}
        </Button>
        <Link to={`/edit-quotation/${id}`}>
          <Button variant="outline" size="sm" className="border-[var(--border-color)] text-[var(--text-secondary)]">
            <Edit2 className="mr-2 h-3 w-3" /> Edit
          </Button>
        </Link>
        <Button onClick={() => quotations.downloadPdf(id)} variant="outline" size="sm"
          className="border-[var(--border-color)] text-[var(--text-secondary)]" data-testid="download-pdf-btn">
          <Download className="mr-2 h-3 w-3" /> PDF
        </Button>
        <Button onClick={() => window.print()} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="print-btn">
          <Printer className="mr-2 h-3 w-3" /> Print
        </Button>
      </div>
    </div>
  );
}
