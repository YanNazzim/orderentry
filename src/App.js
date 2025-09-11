import React, { useState } from "react";
import "./App.css";

const API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent";
const API_KEY = process.env.REACT_APP_GOOGLE_API_KEY;

const fetchWithBackoff = async (payload, maxAttempts = 5) => {
  let attempt = 0;
  while (attempt < maxAttempts) {
    try {
      const response = await fetch(`${API_URL}?key=${API_KEY}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (response.status !== 429) {
        return response;
      }
    } catch (e) {
      console.error("Fetch attempt failed:", e);
    }

    const delay = Math.pow(2, attempt) * 1000;
    await new Promise((res) => setTimeout(res, delay));
    attempt++;
  }
  throw new Error("Maximum API call attempts exceeded.");
};

const Spinner = () => (
  <div className="spinner-container">
    <div className="spinner"></div>
  </div>
);

const App = () => {
  const [file, setFile] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleFileChange = (event) => {
    setFile(event.target.files[0]);
    setData(null);
    setError(null);
  };

  const extractData = () => {
    if (!file) {
      setError("Please upload a purchase order file.");
      return;
    }

    if (!API_KEY) {
      setError(
        "API key is missing. Please set your REACT_APP_GOOGLE_API_KEY environment variable."
      );
      return;
    }

    setLoading(true);
    setError(null);
    setData(null);

    setTimeout(() => {
      try {
        const reader = new FileReader();
        reader.readAsDataURL(file);

        reader.onload = async () => {
          try {
            const base64Data = reader.result.split(",")[1];
            const userPrompt = {
              parts: [
                {
                  text: `Extract the following information from this purchase order document: Customer Name, Customer Address, a single PO number, a single Order Number, a single Quote Number, a single Customer Email, and a list of line items. For each line item, extract the part number, any prefixes (like '12', '55', '56', '72'), the description, quantity, and unit price. The base part number may be '8804 ETL' or 'AD-PE8406 ETL' with prefixes appearing before it. Format the output as a JSON object with the following schema:
                {
                  "customerInfo": {
                    "name": "string",
                    "address": "string",
                    "email": "string"
                  },
                  "poNumber": "string",
                  "orderNumber": "string",
                  "quoteNumber": "string",
                  "lineItems": [
                    {
                      "partNumber": "string",
                      "prefixes": ["string"],
                      "description": "string",
      "quantity": "number",
                      "unitPrice": "number"
                    }
                  ]
                }
                If any data is not present, use null or "N/A" for strings and 0 for numbers. If no prefixes are found, the prefixes array should be empty.`,
                },
                { inlineData: { mimeType: file.type, data: base64Data } },
              ],
            };

            const payload = {
              contents: [userPrompt],
              generationConfig: {
                responseMimeType: "application/json",
              },
            };

            const response = await fetchWithBackoff(payload);

            if (!response.ok) {
              throw new Error(
                `API call failed with status: ${response.status} - ${response.statusText}`
              );
            }

            const result = await response.json();
            const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;

            if (jsonText) {
              const parsedData = JSON.parse(jsonText);
              setData(parsedData);
            } else {
              setError(
                "Failed to extract data. The response was empty or malformed."
              );
            }
          } catch (err) {
            console.error(err);
            setError(`An unexpected error occurred: ${err.message}`);
          } finally {
            setLoading(false);
          }
        };

        reader.onerror = () => {
          setError("Failed to read file.");
          setLoading(false);
        };
      } catch (err) {
        console.error(err);
        setError(`An unexpected error occurred: ${err.message}`);
        setLoading(false);
      }
    }, 0);
  };

  const handleCopyLineItem = (item, index) => {
    const prefixes = item.prefixes?.join(", ") || "N/A";
    const partNumber = item.partNumber || "N/A";
    const description = item.description || "N/A";
    const quantity = item.quantity !== null && item.quantity !== undefined
      ? item.quantity
      : "N/A";
    const unitPrice = item.unitPrice !== null && item.unitPrice !== undefined
      ? `$${item.unitPrice.toFixed(2)}`
      : "N/A";

    const textToCopy = `Line #: ${index}\nPrefixes: ${prefixes}\nPart Number: ${partNumber}\nDescription: ${description}\nQuantity: ${quantity}\nUnit Price: ${unitPrice}`;

    navigator.clipboard.writeText(textToCopy).then(() => {
      alert("Line item copied to clipboard!");
    }).catch(err => {
      console.error('Failed to copy text: ', err);
      alert("Failed to copy line item.");
    });
  };

  return (
    <div className="app-container">
      <div className="main-card animate-fade-in">
        <h1 className="title">
          <span className="logo-text">Sargent</span> PO Analyzer
        </h1>
        <p className="subtitle">
          Instantly extract and organize key data from purchase orders using AI.
        </p>

        <div className="file-input-section">
          <input
            type="file"
            accept="image/*,application/pdf"
            onChange={handleFileChange}
            className="file-input"
          />
          <button
            onClick={extractData}
            disabled={loading || !file || !API_KEY}
            className="analyze-button"
          >
            {loading ? <Spinner /> : "Analyze PO"}
          </button>
        </div>

        {error && <div className="message error-message">Error: {error}</div>}

        {data && (
          <div className="results-section animate-fade-in">
            <h2 className="results-title">Extracted Order Information</h2>

            <div className="info-grid">
              <div className="info-card">
                <h3 className="card-title">Customer Information</h3>
                <p>
                  <strong>Name:</strong> {data.customerInfo?.name || "N/A"}
                </p>
                <p>
                  <strong>Address:</strong>{" "}
                  {data.customerInfo?.address || "N/A"}
                </p>
                <p>
                  <strong>Email:</strong> {data.customerInfo?.email || "N/A"}
                </p>
              </div>
              <div className="info-card">
                <h3 className="card-title">Order Details</h3>
                <p>
                  <strong>PO Number:</strong> {data.poNumber || "N/A"}
                </p>
                <p>
                  <strong>Order Number:</strong> {data.orderNumber || "N/A"}
                </p>
                <p>
                  <strong>Quote Number:</strong> {data.quoteNumber || "N/A"}
                </p>
              </div>
            </div>

            <h3 className="line-items-title">Line Items</h3>
            <div className="table-container">
              <table className="line-item-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Prefixes</th>
                    <th>Part Number</th>
                    <th>Description</th>
                    <th>Quantity</th>
                    <th>Unit Price</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lineItems?.length > 0 ? (
                    data.lineItems.map((item, index) => (
                      <tr key={index} className="line-item-row">
                        <td>{index + 1}</td>
                        <td>{item.prefixes?.join(", ") || "N/A"}</td>
                        <td>{item.partNumber || "N/A"}</td>
                        <td>{item.description || "N/A"}</td>
                        <td>
                          {item.quantity !== null && item.quantity !== undefined
                            ? item.quantity
                            : "N/A"}
                        </td>
                        <td>
                          $
                          {item.unitPrice !== null &&
                          item.unitPrice !== undefined
                            ? item.unitPrice.toFixed(2)
                            : "N/A"}
                        </td>
                        <td>
                          <button
                            className="copy-button"
                            onClick={() => handleCopyLineItem(item, index + 1)}
                          >
                            Copy
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="7" className="no-items">
                        No line items found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;