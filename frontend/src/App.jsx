import { useEffect, useState } from 'react';

const initialQuestion = 'What were the top five products by revenue in the latest month available?';
const API_BASE = import.meta.env.VITE_API_BASE || (
  typeof window !== 'undefined' && window.location.hostname !== 'localhost'
    ? 'http://agentic-bi-backend-lb-756255764.ap-southeast-2.elb.amazonaws.com'
    : 'http://localhost:5001'
);

const formatCurrency = (value) => new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
}).format(Number(value) || 0);

function App() {
  const [question, setQuestion] = useState(initialQuestion);
  const [result, setResult] = useState(null);
  const [savedReports, setSavedReports] = useState([]);
  const [workspaces, setWorkspaces] = useState([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('');
  const [activeUserId, setActiveUserId] = useState('demo-user');
  const [authUser, setAuthUser] = useState(() => {
    try {
      const savedUser = localStorage.getItem('agentic-bi-auth-user');
      return savedUser ? JSON.parse(savedUser) : null;
    } catch (error) {
      return null;
    }
  });
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('agentic-bi-auth-token') || '');
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '' });
  const [authError, setAuthError] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceShared, setWorkspaceShared] = useState(false);
  const [workspaceReports, setWorkspaceReports] = useState([]);
  const [reportSearch, setReportSearch] = useState('');
  const [workspaceSearch, setWorkspaceSearch] = useState('');
  const [reportSort, setReportSort] = useState('newest');
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [savingReport, setSavingReport] = useState(false);
  const [error, setError] = useState('');

  const getCurrentUserId = () => (authUser?.email || activeUserId || 'demo-user');

  const withAuthHeaders = (headers = {}) => ({
    ...headers,
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
  });

  const loadSavedReports = async (userId = getCurrentUserId()) => {
    try {
      const response = await fetch(`${API_BASE}/api/reports?userId=${encodeURIComponent(userId)}`, {
        headers: withAuthHeaders(),
      });
      const payload = await response.json();
      setSavedReports(payload.reports || []);
    } catch (err) {
      console.warn('Unable to load saved reports.', err.message);
    }
  };

  const loadWorkspaces = async (userId = getCurrentUserId()) => {
    try {
      const response = await fetch(`${API_BASE}/api/workspaces?userId=${encodeURIComponent(userId)}`, {
        headers: withAuthHeaders(),
      });
      const payload = await response.json();
      const nextWorkspaces = payload.workspaces || [];
      setWorkspaces(nextWorkspaces);

      if (!selectedWorkspaceId && nextWorkspaces.length > 0) {
        setSelectedWorkspaceId(nextWorkspaces[0].id);
      }
    } catch (err) {
      console.warn('Unable to load workspaces.', err.message);
    }
  };

  const loadWorkspaceReports = async (workspaceId, userId = getCurrentUserId()) => {
    if (!workspaceId) {
      setWorkspaceReports([]);
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/workspaces/${workspaceId}/reports?userId=${encodeURIComponent(userId)}`, {
        headers: withAuthHeaders(),
      });
      const payload = await response.json();
      setWorkspaceReports(payload.reports || []);
    } catch (err) {
      console.warn('Unable to load workspace reports.', err.message);
      setWorkspaceReports([]);
    }
  };

  useEffect(() => {
    const resolvedUserId = authUser?.email || activeUserId;
    setSelectedWorkspaceId('');
    loadSavedReports(resolvedUserId);
    loadWorkspaces(resolvedUserId);
  }, [activeUserId, authUser]);

  useEffect(() => {
    if (!authToken) {
      return;
    }

    const validateSession = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/auth/me`, {
          headers: withAuthHeaders(),
        });

        if (!response.ok) {
          throw new Error('Session invalid');
        }

        const payload = await response.json();
        if (payload.user) {
          setAuthUser(payload.user);
          setActiveUserId(payload.user.email);
        }
      } catch (_error) {
        setAuthUser(null);
        setAuthToken('');
        setActiveUserId('demo-user');
        localStorage.removeItem('agentic-bi-auth-token');
        localStorage.removeItem('agentic-bi-auth-user');
      }
    };

    validateSession();
  }, [authToken]);

  useEffect(() => {
    const resolvedUserId = authUser?.email || activeUserId;
    if (selectedWorkspaceId) {
      loadWorkspaceReports(selectedWorkspaceId, resolvedUserId);
    } else {
      setWorkspaceReports([]);
    }
  }, [selectedWorkspaceId, activeUserId, authUser]);

  const askQuestion = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE}/api/ask`, {
        method: 'POST',
        headers: withAuthHeaders({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ question, userId: getCurrentUserId() }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || 'Request failed.');
      }

      setResult(payload);
      await loadSavedReports();
    } catch (err) {
      setError(err.message || 'Something went wrong.');
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const saveReport = async () => {
    if (!result) {
      return;
    }

    setSavingReport(true);

    try {
      const response = await fetch(`${API_BASE}/api/reports`, {
        method: 'POST',
        headers: withAuthHeaders({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          question: result.question,
          summary: result.summary,
          topProduct: result.overview?.topProduct,
          totalRevenue: result.overview?.totalRevenue,
          insight: result.insight?.summary,
          recommendation: result.recommendation,
          sql: result.sql,
          userId: getCurrentUserId(),
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to save report.');
      }

      if (selectedWorkspaceId) {
        await fetch(`${API_BASE}/api/workspaces/${selectedWorkspaceId}/reports`, {
          method: 'POST',
          headers: withAuthHeaders({
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({
            question: result.question,
            summary: result.summary,
            topProduct: result.overview?.topProduct,
            totalRevenue: result.overview?.totalRevenue,
            insight: result.insight?.summary,
            recommendation: result.recommendation,
            sql: result.sql,
            userId: getCurrentUserId(),
          }),
        });
        await loadWorkspaceReports(selectedWorkspaceId);
      }

      await loadSavedReports();
      await loadWorkspaces();
      setError('');
      return payload.report;
    } catch (err) {
      setError(err.message || 'Unable to save report.');
    } finally {
      setSavingReport(false);
    }
  };

  const createWorkspace = async () => {
    const trimmedName = workspaceName.trim();

    if (!trimmedName) {
      setError('A workspace name is required.');
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/workspaces`, {
        method: 'POST',
        headers: withAuthHeaders({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ name: trimmedName, userId: authUser?.email || activeUserId, shared: workspaceShared }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to create workspace.');
      }

      setWorkspaceName('');
      setWorkspaceShared(false);
      await loadWorkspaces(authUser?.email || activeUserId);
      setSelectedWorkspaceId(payload.workspace.id);
      setError('');
    } catch (err) {
      setError(err.message || 'Unable to create workspace.');
    }
  };

  const handleAuthSubmit = async (event) => {
    event.preventDefault();
    setAuthError('');

    try {
      const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const payloadBody = authMode === 'login'
        ? { email: authForm.email, password: authForm.password }
        : { name: authForm.name, email: authForm.email, password: authForm.password };

      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payloadBody),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || 'Authentication failed.');
      }

      setAuthToken(payload.token);
      setAuthUser(payload.user);
      setActiveUserId(payload.user.email);
      localStorage.setItem('agentic-bi-auth-token', payload.token);
      localStorage.setItem('agentic-bi-auth-user', JSON.stringify(payload.user));
      setAuthForm({ name: '', email: '', password: '' });
      setError('');
    } catch (err) {
      setAuthError(err.message || 'Authentication failed.');
    }
  };

  const handleLogout = () => {
    setAuthUser(null);
    setAuthToken('');
    setActiveUserId('demo-user');
    localStorage.removeItem('agentic-bi-auth-token');
    localStorage.removeItem('agentic-bi-auth-user');
  };

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/metrics`);
        if (!response.ok) {
          throw new Error('Metrics unavailable');
        }

        const payload = await response.json();
        setMetrics(payload);
      } catch (err) {
        console.warn('Unable to load metrics.', err.message);
      }
    };

    fetchMetrics();
    const intervalId = setInterval(fetchMetrics, 10000);
    return () => clearInterval(intervalId);
  }, []);

  const filteredWorkspaces = workspaces.filter((workspace) => {
    const target = workspaceSearch.trim().toLowerCase();
    if (!target) {
      return true;
    }

    return workspace.name.toLowerCase().includes(target);
  });

  const filteredSavedReports = (savedReports || []).filter((report) => {
    const target = reportSearch.trim().toLowerCase();
    if (!target) {
      return true;
    }

    return (report.question || '').toLowerCase().includes(target)
      || (report.summary || '').toLowerCase().includes(target)
      || (report.topProduct || '').toLowerCase().includes(target);
  });

  const sortedSavedReports = [...filteredSavedReports].sort((a, b) => {
    const timeA = new Date(a.createdAt || 0).getTime();
    const timeB = new Date(b.createdAt || 0).getTime();
    return reportSort === 'oldest' ? timeA - timeB : timeB - timeA;
  });

  const teamSummary = {
    sharedWorkspaces: workspaces.filter((workspace) => workspace.shared).length,
    savedReports: savedReports.length,
    activeRole: authUser?.role || 'member',
  };

  const exportResult = (format = 'json') => {
    if (!result) {
      return;
    }

    const exportData = {
      generatedAt: new Date().toISOString(),
      question: result.question,
      summary: result.summary,
      answer: result.answer,
      overview: result.overview,
      insight: result.insight,
      recommendation: result.recommendation,
      sql: result.sql,
      data: result.data,
      chartData: result.chartData,
      regionBreakdown: result.regionBreakdown,
      ragDocuments: result.ragDocuments,
      mlAnalysis: result.mlAnalysis,
      forecast: result.forecast,
      kpiDrift: result.kpiDrift,
      llmContext: result.llmContext,
      signals: result.signals,
      anomalies: result.anomalies,
      orchestration: result.orchestration,
      evidence: result.evidence,
      agentTrace: result.agentTrace,
    };

    const jsonContent = JSON.stringify(exportData, null, 2);
    const csvRows = [
      ['Question', 'Summary', 'Answer', 'Top Product', 'Total Revenue'],
      [
        result.question || '',
        result.summary || '',
        result.answer || '',
        result.overview?.topProduct || '',
        result.overview?.totalRevenue || '',
      ],
    ];

    const csvContent = csvRows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([format === 'json' ? jsonContent : csvContent], {
      type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `agentic-bi-report.${format}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Product Intelligence</p>
          <h1>Agentic BI Platform</h1>
        </div>

        <div className="auth-header">
          {authUser ? (
            <>
              <span>{authUser.name}</span>
              <button type="button" className="secondary-button" onClick={handleLogout}>Logout</button>
            </>
          ) : (
            <span>Demo mode</span>
          )}
        </div>
      </header>

      <main className="dashboard">
        <section className="panel metrics-panel">
          <h3>Operations metrics</h3>
          <div className="metrics-grid">
            <div className="kpi-card">
              <span className="kpi-label">Status</span>
              <strong>{metrics?.health?.status || 'healthy'}</strong>
              <small>{metrics?.health?.service || 'agentic-bi-backend'}</small>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Uptime</span>
              <strong>{metrics ? `${metrics.uptimeSeconds}s` : '—'}</strong>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Requests</span>
              <strong>{metrics ? metrics.totalRequests : '—'}</strong>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Avg latency</span>
              <strong>{metrics ? `${metrics.averageResponseMs} ms` : '—'}</strong>
            </div>
          </div>
          <div className="team-summary-grid">
            <div className="team-summary-card">
              <span className="kpi-label">Shared workspaces</span>
              <strong>{teamSummary.sharedWorkspaces}</strong>
            </div>
            <div className="team-summary-card">
              <span className="kpi-label">Saved reports</span>
              <strong>{teamSummary.savedReports}</strong>
            </div>
            <div className="team-summary-card">
              <span className="kpi-label">Active role</span>
              <strong>{teamSummary.activeRole}</strong>
            </div>
          </div>

          {metrics?.alerts?.length > 0 && (
            <div className="alert-list">
              {metrics.alerts.map((alert, index) => (
                <div key={`${alert.message}-${index}`} className={`alert-item ${alert.level}`}>
                  <strong>{alert.level.toUpperCase()}</strong>
                  <span>{alert.message}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {!authUser && (
          <section className="panel auth-panel">
            <div className="auth-toggle-row">
              <button
                type="button"
                className={authMode === 'login' ? 'secondary-button active' : 'secondary-button'}
                onClick={() => setAuthMode('login')}
              >
                Sign in
              </button>
              <button
                type="button"
                className={authMode === 'register' ? 'secondary-button active' : 'secondary-button'}
                onClick={() => setAuthMode('register')}
              >
                Register
              </button>
            </div>

            <form onSubmit={handleAuthSubmit} className="auth-form">
              {authMode === 'register' && (
                <label>
                  Name
                  <input
                    type="text"
                    value={authForm.name}
                    onChange={(event) => setAuthForm((current) => ({ ...current, name: event.target.value }))}
                  />
                </label>
              )}

              <label>
                Email
                <input
                  type="email"
                  value={authForm.email}
                  onChange={(event) => setAuthForm((current) => ({ ...current, email: event.target.value }))}
                />
              </label>

              <label>
                Password
                <input
                  type="password"
                  value={authForm.password}
                  onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))}
                />
              </label>

              {authError && <p className="error">{authError}</p>}

              <button type="submit">
                {authMode === 'login' ? 'Sign in' : 'Create account'}
              </button>
            </form>
          </section>
        )}
        <section className="panel input-panel">
          <label htmlFor="question">Business question</label>
          <textarea
            id="question"
            rows="4"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
          />

          {!authUser && (
            <div className="workspace-controls">
              <label htmlFor="userSelect">Active user</label>
              <div className="workspace-row">
                <select id="userSelect" value={activeUserId} onChange={(event) => setActiveUserId(event.target.value)}>
                  <option value="demo-user">demo-user</option>
                  <option value="alice">alice</option>
                  <option value="bob">bob</option>
                </select>
              </div>
            </div>
          )}

          <div className="workspace-controls">
            <label htmlFor="workspaceSelect">Workspace</label>
            <div className="workspace-row">
              <input
                type="text"
                value={workspaceSearch}
                onChange={(event) => setWorkspaceSearch(event.target.value)}
                placeholder="Filter workspaces"
              />

              <select id="workspaceSelect" value={selectedWorkspaceId} onChange={(event) => setSelectedWorkspaceId(event.target.value)}>
                {filteredWorkspaces.length === 0 ? (
                  <option value="">No workspaces yet</option>
                ) : (
                  filteredWorkspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name}{workspace.shared ? ' • Shared' : ''}
                    </option>
                  ))
                )}
              </select>

              <input
                type="text"
                value={workspaceName}
                onChange={(event) => setWorkspaceName(event.target.value)}
                placeholder="New workspace"
              />

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={workspaceShared}
                  onChange={(event) => setWorkspaceShared(event.target.checked)}
                />
                Share with team
              </label>

              <button type="button" className="secondary-button" onClick={createWorkspace}>
                Add workspace
              </button>
            </div>
          </div>

          <div className="action-row">
            <button onClick={askQuestion} disabled={loading || !question.trim()}>
              {loading ? 'Analyzing...' : 'Ask platform'}
            </button>

            {result && (
              <>
                <button className="secondary-button" onClick={saveReport} disabled={savingReport}>
                  {savingReport ? 'Saving...' : 'Save report'}
                </button>
                <button type="button" className="secondary-button" onClick={() => exportResult('json')}>
                  Export JSON
                </button>
                <button type="button" className="secondary-button" onClick={() => exportResult('csv')}>
                  Export CSV
                </button>
              </>
            )}
          </div>

          {error && <p className="error">{error}</p>}
        </section>

        <section className="panel result-panel">
          {!result && !loading && (
            <p className="placeholder">Submit a business question to trigger the SQL + RAG + ML workflow.</p>
          )}

          {result && (
            <>
              <h2>Answer</h2>
              <p>{result.answer}</p>

              <div className="meta-grid overview-grid">
                <div className="kpi-card">
                  <span className="kpi-label">Total revenue</span>
                  <strong>{formatCurrency(result.overview?.totalRevenue)}</strong>
                </div>
                <div className="kpi-card">
                  <span className="kpi-label">Top product</span>
                  <strong>{result.overview?.topProduct || 'N/A'}</strong>
                </div>
                <div className="kpi-card">
                  <span className="kpi-label">Context summary</span>
                  <small>{result.contextSummary || 'No context retrieved.'}</small>
                </div>
              </div>

              <div className="insight-grid">
                <div className="panel compact-panel">
                  <h3>AI insight</h3>
                  <p>{result.insight?.summary || 'No insight available yet.'}</p>
                  <ul>
                    <li>Risk level: {result.insight?.riskLevel || 'low'}</li>
                    <li>Trend: {result.insight?.trend || 'neutral'}</li>
                    <li>Top revenue: {formatCurrency(result.insight?.topRevenue)}</li>
                  </ul>
                </div>

                <div className="panel compact-panel">
                  <h3>Recommended action</h3>
                  <p>{result.recommendation || 'No recommendation available.'}</p>
                </div>
              </div>

              <div className="insight-grid">
                <div className="panel compact-panel">
                  <h3>RAG documents</h3>
                  {(result.ragDocuments || []).length === 0 ? (
                    <p>No matching docs were found for this request.</p>
                  ) : (
                    <ul>
                      {(result.ragDocuments || []).map((document) => (
                        <li key={document.id || document.title}>
                          <strong>{document.title}</strong>
                          <div>{document.content}</div>
                          <small>
                            {document.source?.startsWith('https://') ? (
                              <a href={document.source} target="_blank" rel="noreferrer">
                                {document.attribution || document.source}
                              </a>
                            ) : (
                              document.attribution || document.source
                            )}
                            {document.license ? ` (${document.license})` : ''}
                          </small>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="panel compact-panel">
                  <h3>ML diagnostics</h3>
                  <p>{result.mlAnalysis?.summary || 'Local ML diagnostics are unavailable.'}</p>
                  <ul>
                    {(result.mlAnalysis?.anomalies || []).map((anomaly) => (
                      <li key={`${anomaly.label}-${anomaly.deltaPct}`}>
                        <strong>{anomaly.label}</strong> — {anomaly.deltaPct}% vs baseline ({anomaly.severity})
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="insight-grid">
                <div className="panel compact-panel">
                  <h3>Executive brief</h3>
                  <p>{result.executiveSummary || 'No executive summary available.'}</p>
                </div>

                <div className="panel compact-panel">
                  <h3>Forecast</h3>
                  <p>{result.forecast?.summary || 'No forecast available.'}</p>
                  <ul>
                    <li>Trend: {result.forecast?.trend || 'stable'}</li>
                    <li>Change: {result.forecast?.changePct ?? 0}%</li>
                    <li>Forecast revenue: {formatCurrency(result.forecast?.forecastRevenue)}</li>
                  </ul>
                </div>

                <div className="panel compact-panel">
                  <h3>KPI drift</h3>
                  <p>{result.kpiDrift?.summary || 'No drift data available.'}</p>
                  <ul>
                    {(result.kpiDrift?.alerts || []).map((alert) => (
                      <li key={`${alert.metric}-${alert.variancePct}`}>
                        <strong>{alert.metric}</strong> [{alert.status}] — {alert.variancePct}% vs baseline
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="insight-grid">
                <div className="panel compact-panel">
                  <h3>LLM context</h3>
                  <p>{result.llmContext?.narrative || result.llmContext?.fallback || 'No LLM context available.'}</p>
                  <small>
                    Provider: {result.llmContext?.provider || 'local'} · Model: {result.llmContext?.model || 'deterministic'}
                  </small>
                </div>

                <div className="panel compact-panel">
                  <h3>Forecast confidence</h3>
                  <p>{result.forecast?.confidence || 'steady'}</p>
                </div>
              </div>

              <div className="insight-grid">
                <div className="panel compact-panel">
                  <h3>Agent plan</h3>
                  <ul>
                    {(result.orchestration?.agentPlan || []).map((step) => (
                      <li key={step.name}>
                        <strong>{step.name}</strong>: {step.status} — {step.summary}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="panel compact-panel">
                  <h3>Session memory</h3>
                  <ul>
                    {(result.sessionMemory || []).map((entry) => (
                      <li key={`${entry.time}-${entry.question}`}>
                        <strong>{entry.question}</strong>: {entry.answer}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="insight-grid">
                <div className="panel compact-panel">
                  <h3>Signal summary</h3>
                  <ul>
                    {(result.signals || []).map((signal) => (
                      <li key={signal.label}>
                        <strong>{signal.label}</strong> [{signal.severity}] — {signal.value}: {signal.description}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="panel compact-panel">
                  <h3>Operational anomalies</h3>
                  <ul>
                    {(result.anomalies || []).map((anomaly) => (
                      <li key={`${anomaly.label}-${anomaly.delta}`}>
                        <strong>{anomaly.label}</strong> [{anomaly.severity}] — {anomaly.delta}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="chart-panel panel">
                <h3>Revenue comparison</h3>
                <div className="chart">
                  {(result.chartData || []).map((item) => {
                    const max = Math.max(...(result.chartData || []).map((entry) => entry.value), 1);
                    const width = (item.value / max) * 100;

                    return (
                      <div key={item.label} className="chart-row">
                        <span>{item.label}</span>
                        <div className="bar-track">
                          <div className="bar-fill" style={{ width: `${width}%` }} />
                        </div>
                        <strong>{formatCurrency(item.value)}</strong>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="chart-panel panel">
                <h3>Regional revenue</h3>
                <div className="chart">
                  {(result.regionBreakdown || []).map((item) => {
                    const max = Math.max(...(result.regionBreakdown || []).map((entry) => entry.value), 1);
                    const width = (item.value / max) * 100;

                    return (
                      <div key={item.label} className="chart-row">
                        <span>{item.label}</span>
                        <div className="bar-track">
                          <div className="bar-fill secondary-bar" style={{ width: `${width}%` }} />
                        </div>
                        <strong>{formatCurrency(item.value)}</strong>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="panel compact-panel saved-reports-panel">
                <h3>Saved reports</h3>
                <div className="report-toolbar">
                  <input
                    type="text"
                    value={reportSearch}
                    onChange={(event) => setReportSearch(event.target.value)}
                    placeholder="Search saved reports"
                  />
                  <select value={reportSort} onChange={(event) => setReportSort(event.target.value)}>
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                  </select>
                </div>
                {sortedSavedReports.length === 0 ? (
                  <p>No reports match this search.</p>
                ) : (
                  <ul>
                    {sortedSavedReports.map((report) => (
                      <li key={report.id}>
                        <strong>{report.question}</strong>
                        <div>{report.summary}</div>
                        <small>{new Date(report.createdAt).toLocaleString()}</small>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="meta-grid">
                <div>
                  <h3>Summary</h3>
                  <p>{result.summary}</p>
                </div>
                <div>
                  <h3>Generated SQL</h3>
                  <code>{result.sql}</code>
                </div>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.data.map((row) => (
                      <tr key={row.product}>
                        <td>{row.product}</td>
                        <td>{formatCurrency(row.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="meta-grid">
                <div>
                  <h3>Evidence</h3>
                  <ul>
                    {result.evidence.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h3>Agent trace</h3>
                  <ul>
                    {result.agentTrace.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
