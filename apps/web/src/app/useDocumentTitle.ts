import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { tenantQuery } from '../api/queries.ts';

/** `<title>`: "Page — Tenant", or just the tenant name on the home page. */
export function useDocumentTitle(title: string | null | undefined): void {
  const qc = useQueryClient();
  useEffect(() => {
    const name = qc.getQueryData(tenantQuery.queryKey)?.branding.displayName;
    document.title = [title, name].filter(Boolean).join(' — ') || 'Saunaklar';
  }, [title, qc]);
}
