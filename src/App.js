import React, { useState } from "react";
import "./App.css";

// --- CONFIGURATION ---
const API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";
const API_KEY = process.env.REACT_APP_GOOGLE_API_KEY;

// --- MOCK INITIAL TEAM STATE ---
// Colors updated to "Neon" versions for dark mode
const INITIAL_TEAM = [
  { id: 1, name: "Hector Origel", role: "Order Entry", cards: 5, totalPages: 45, color: "#3b82f6" },
  { id: 2, name: "Jairo Figueroa", role: "Order Entry", cards: 4, totalPages: 25, color: "#10b981" },
  { id: 5, name: "Claudia Franco", role: "Order Entry", cards: 9, totalPages: 12, color: "#ec4899" },
  { id: 6, name: "Emmanuel Rojas", role: "Order Entry", cards: 3, totalPages: 30, color: "#06b6d4" },
  { id: 7, name: "Paulina Lobo", role: "Order Entry", cards: 0, totalPages: 0, color: "#84cc16" },
  { id: 3, name: "Maureen Thompson", role: "Intl/Keying", cards: 12, totalPages: 60, color: "#8b5cf6" },
  { id: 4, name: "Susan Alpert", role: "Chargebacks", cards: 2, totalPages: 5, color: "#f59e0b" },
];

const fetchWithBackoff = async (payload, maxAttempts = 3) => {
  let attempt = 0;
  while (attempt < maxAttempts) {
    try {
      const response = await fetch(`${API_URL}?key=${API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.status !== 429) return response;
    } catch (e) {
      console.error("Fetch failed:", e);
    }
    
    const delay = 1000 * Math.pow(2, attempt);
    await new Promise((resolve) => setTimeout(resolve, delay));
    attempt++;
  }
  throw new Error("API Limit Exceeded");
};

const Spinner = () => <div className="spinner"></div>;

const App = () => {
  const [file, setFile] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [currentOrder, setCurrentOrder] = useState(null);
  const [error, setError] = useState(null);
  const [team, setTeam] = useState(INITIAL_TEAM);
  const [routingLog, setRoutingLog] = useState([]);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
    setCurrentOrder(null);
    setError(null);
  };

  const updateTeamStats = (id, field, value) => {
    setTeam(team.map(member => 
      member.id === id ? { ...member, [field]: parseInt(value) || 0 } : member
    ));
  };

  // --- LOGIC: ROUTING RULES ENGINE ---
  const determineRouting = (data) => {
    const logs = [];
    logs.push("> Initializing Routing Protocol...");
    logs.push("> Scanning content for flags...");

    let route = "Order Entry";
    let flags = [];
    let reason = "Standard Order";
    let evidence = null;

    // 1. Check Line Item Volume
    const actualLineCount = data.totalLineCount || data.lineItems?.length || 0;
    
    if (actualLineCount >= 10) {
      flags.push("10+ LINES");
      logs.push(`! ALERT: High Volume (${actualLineCount} lines)`);
    } else if (actualLineCount > 0 && actualLineCount <= 3) {
      flags.push("CHECKERED FLAG");
    }

    // 2. Check for Keying Indicators
    const keyingPrefixes = ["10", "21", "22", "51", "59", "82", "83", "73", "AL"];
    const keyingKeywords = ["MK", "GMK", "SKD", "KA", "KEYED", "MASTER KEY", "GRAND MASTER", "KESO"];

    let isKeying = false;
    
    if (data.lineItems) {
      for (let item of data.lineItems) {
        let cleanPrefixList = (item.prefixes || []).map(p => p.replace(/[^0-9A-Z]/g, ''));
        
        // Hallucination Fix
        if (item.partNumber && item.partNumber.startsWith("31") && cleanPrefixList.includes("AL")) {
           console.log(`Ignoring False Positive: 31/AL mismatch`);
           continue; 
        }

        const badPrefix = cleanPrefixList.find(p => keyingPrefixes.includes(p));

        if (badPrefix) {
          isKeying = true;
          reason = `Restricted Prefix '${badPrefix}'`;
          evidence = `LINE DETECTED:\nLine #: ${item.lineNumber || 'N/A'}\nPage: ${item.pageNumber || '?'}\nPart: ${item.partNumber}\nPrefix: [${badPrefix}]`;
          logs.push(`> MATCH FOUND: Keying Prefix [${badPrefix}] on Page ${item.pageNumber}`);
          break;
        }
      }
    }

    if (!isKeying) {
      const safeSearchFields = [
         ...(data.routingKeywords || []),
         ...(data.pages || []).map(p => p.summary),
         ...(data.pages || []).flatMap(p => p.itemsOnPage?.map(i => i.desc) || [])
      ];
      
      const globalText = safeSearchFields.join(" ").toUpperCase();
      const foundKeyword = keyingKeywords.find(kw => globalText.includes(kw));

      if (foundKeyword) {
          isKeying = true;
          reason = `Global Keyword Match`;
          evidence = `KEYWORD DETECTED: "${foundKeyword}" found in notes/summary.`;
          logs.push(`> MATCH FOUND: Global Keyword [${foundKeyword}]`);
      }
    }

    if (isKeying) {
      const keyingRep = team.find(m => m.role.includes("Keying"));
      route = keyingRep ? keyingRep.name : "Keying Dept"; 
      logs.push(`> ROUTING: Directed to Special Handling (${route})`);
    } else {
      logs.push("> No restrictions found.");
      logs.push("> Calculating workload balance...");
      
      const oeReps = team.filter(m => m.role === "Order Entry");
      const targetRep = oeReps.sort((a, b) => a.totalPages - b.totalPages)[0];
      
      route = targetRep.name;
      reason = `Lowest Page Load (${targetRep.totalPages}pgs)`;
      logs.push(`> ASSIGNMENT: ${targetRep.name} (Load: ${targetRep.totalPages})`);
    }

    return { route, flags, reason, evidence, logs, pageCount: data.pageCount || 1 };
  };

  const processOrder = async () => {
    if (!file || !API_KEY) return;
    setAnalyzing(true);
    setRoutingLog([]);
    setError(null);

    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async () => {
        const base64Data = reader.result.split(",")[1];
        
        const promptText = `
          Analyze this Purchase Order. 
          
          TASK 1: IDENTIFY CUSTOMER (From Email Domain on Page 1)
          
          TASK 2: EXTRACT DETAILS
          - PO Number.
          - Total page count (estimated).
          - "totalLineCount": Total # of items.
          - Routing Keywords: Look for "DPAS", "Quick Ship", "Keying", "Master Key", "Keso", "MK", "GMK", "SKD", "KA".
          
          TASK 3: LINE ITEM EXTRACTION
          - If >20 lines, extract the FIRST 5 lines AND any lines with prefixes: 10, 21, 22, 51, 59, 82, 83, 73, AL.
          - Identify "lineNumber" and "pageNumber".
          
          TASK 4: PAGE SUMMARIES
          - Return "pages" array with "itemsOnPage" summary.

          Return JSON Schema:
          {
            "customerInfo": { "name": "...", "email": "...", "source": "..." },
            "poNumber": "...",
            "pageCount": number,
            "totalLineCount": number,
            "routingKeywords": ["..."],
            "lineItems": [ 
               { 
                 "lineNumber": "string", 
                 "pageNumber": number, 
                 "partNumber": "string", 
                 "prefixes": ["string"], 
                 "quantity": number 
               } 
            ],
            "pages": [
              {
                "pageNumber": 1,
                "type": "PO Data",
                "summary": "...",
                "itemsOnPage": [ { "qty": "1", "desc": "..." } ] 
              }
            ]
          }
        `;

        const payload = {
          contents: [{
            parts: [{ text: promptText }, { inlineData: { mimeType: file.type, data: base64Data } }]
          }],
          generationConfig: { responseMimeType: "application/json" }
        };

        const response = await fetchWithBackoff(payload);
        const result = await response.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!text) throw new Error("No data returned from AI");
        
        const cleanText = text.replace(/```json/g, "").replace(/```/g, "").trim();

        let extractedData;
        try {
          extractedData = JSON.parse(cleanText);
        } catch (parseErr) {
          console.error("JSON Parse Error:", parseErr);
          throw new Error("Analysis Failed. Please try a clearer file.");
        }
        
        const decision = determineRouting(extractedData);
        
        const finalOrder = { ...extractedData, ...decision };
        setCurrentOrder(finalOrder);
        setRoutingLog(decision.logs);

        setTeam(prevTeam => prevTeam.map(member => {
            if (member.name === decision.route) {
            return {
                ...member,
                cards: member.cards + 1,
                totalPages: member.totalPages + (finalOrder.pageCount || 1)
            };
            }
            return member;
        }));

        setAnalyzing(false);
      };
    } catch (err) {
      console.error(err);
      setError(err.message);
      setAnalyzing(false);
    }
  };

  return (
    <div className="app-container">
      <header className="header">
        <h1><span className="brand">SARGENT</span> INTELLIGENT ROUTER</h1>
        <p>AI-Driven Order Entry & Workload Distribution</p>
      </header>

      {/* DASHBOARD */}
      <section className="dashboard">
        <div className="section-header">
          <h2>LIVE OPS :: TEAM LOAD</h2>
          <span className="badge">SYSTEM ACTIVE</span>
        </div>
        <div className="team-grid">
          {team.map(member => (
            <div key={member.id} className="team-card" style={{borderTopColor: member.color}}>
              <div className="member-info">
                <h3>{member.name}</h3>
                <span className="role">{member.role}</span>
              </div>
              <div className="stats-row">
                <div className="stat">
                  <label>Active Cards</label>
                  <input 
                    type="number" 
                    value={member.cards} 
                    onChange={(e) => updateTeamStats(member.id, 'cards', e.target.value)}
                  />
                </div>
                <div className="stat">
                  <label>Total Pages</label>
                  <input 
                    type="number" 
                    value={member.totalPages} 
                    onChange={(e) => updateTeamStats(member.id, 'totalPages', e.target.value)}
                    className={member.role === "Order Entry" ? "highlight-stat" : ""}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* MAIN WORK AREA */}
      <div className="main-work-area">
        <div className="upload-panel">
          <div className="section-header">
            <h3>INCOMING STREAM</h3>
          </div>
          <div className="upload-area">
             <input type="file" onChange={handleFileChange} className="file-input" />
          </div>
          <button 
            onClick={processOrder} 
            disabled={!file || analyzing}
            className="process-btn"
          >
            {analyzing ? <Spinner /> : "ANALYZE & ROUTE"}
          </button>
          
          {error && <div style={{color: '#fca5a5', marginTop: '10px', fontSize: '0.9rem', padding: '10px', background: 'rgba(239, 68, 68, 0.2)', borderRadius: '4px', border: '1px solid #ef4444'}}><strong>ERROR:</strong> {error}</div>}

          {currentOrder && (
            <div className="po-summary fade-in">
              <h4>EXTRACTION RESULTS</h4>
              <div className="summary-row">
                <p>PO #: <strong>{currentOrder.poNumber}</strong></p>
                <p>Pages: <strong>{currentOrder.pageCount}</strong></p>
              </div>
              <div className="summary-row" style={{borderLeft: '4px solid var(--primary)'}}>
                 <p>{currentOrder.customerInfo?.name}</p>
              </div>
               <p style={{fontSize:'0.7rem', color:'var(--text-muted)', marginTop:'5px'}}>
                  SRC: {currentOrder.customerInfo?.source || "AI INFERENCE"}
               </p>
              
              <div className="tags">
                {currentOrder.flags.map((f,i) => <span key={i} className="tag flag">{f}</span>)}
              </div>
            </div>
          )}
        </div>

        <div className="routing-panel">
          <div className="section-header">
            <h3>DECISION LOGIC</h3>
            <span className="badge">v2.4.0</span>
          </div>
          <div className="decision-tree">
            {routingLog.length === 0 && <p className="placeholder">// WAITING FOR DATA STREAM...</p>}
            {routingLog.map((log, i) => (
              <div key={i} className="log-step fade-in" style={{animationDelay: `${i * 0.1}s`}}>
                <div className="step-marker"></div>
                <p>{log}</p>
              </div>
            ))}
            {currentOrder && (
              <div className="final-verdict fade-in">
                <span>TARGET ASSIGNMENT</span>
                <h2>{currentOrder.route}</h2>
                <div className="verdict-reason">
                  {currentOrder.reason}
                  {currentOrder.evidence && (
                     <pre className="evidence-box">{currentOrder.evidence}</pre>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* VERIFICATION SECTION */}
      {currentOrder && currentOrder.pages && (
        <section className="verification-section fade-in">
          <div className="section-header">
            <h3>VISUAL VERIFICATION</h3>
            <span className="badge">PAGE RECONSTRUCTION</span>
          </div>
          <div className="pages-container">
            {currentOrder.pages.map((page, idx) => (
              <div key={idx} className="page-visual">
                <div className="page-header">
                  <span className="page-num">PAGE {page.pageNumber}</span>
                  <span className="page-type" style={{background:'#64748b'}}>{page.type}</span>
                </div>
                <div className="page-content">
                  <p className="page-summary">{page.summary}</p>
                  {page.itemsOnPage && page.itemsOnPage.length > 0 ? (
                    <div className="page-lines">
                      <small style={{color:'#64748b', fontWeight:'bold'}}>DETECTED ITEMS:</small>
                      <ul>
                        {page.itemsOnPage.map((item, i) => (
                          <li key={i}>
                             <strong>{item.qty}x</strong> {item.desc || item.partNumber || "Line Item"}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div className="empty-lines">NO DATA LINES</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

    </div>
  );
};

export default App;