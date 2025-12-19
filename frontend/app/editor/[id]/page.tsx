"use client";
import React, { useState, useEffect, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import axios from "axios";
import { useParams } from "next/navigation";

export default function Editor() {
  const params = useParams();
  const id = params.id;
  const [code, setCode] = useState("");
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  // 1. Initial Load
  useEffect(() => {
    // Fetch initial content
    axios.get(`http://localhost:8000/projects/${id}`).then((res) => {
      setCode(res.data.content);
    });

    // Setup WebSocket
    const socket = new WebSocket(`ws://localhost:8000/ws/${id}`);
    socket.onmessage = (event) => {
      // Receive update from other user
      setCode(event.data);
    };
    setWs(socket);

    return () => socket.close();
  }, [id]);

  // 2. Handle Typing
  const onChange = React.useCallback((val: string) => {
    setCode(val);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(val);
    }
  }, [ws]);

  // 3. Handle Compile
  const handleCompile = async () => {
    setCompiling(true);
    try {
      const res = await axios.post(`http://localhost:8000/projects/${id}/compile`);
      const taskId = res.data.task_id;
      
      // Poll for result (Simple polling for MVP)
      const interval = setInterval(async () => {
        const statusRes = await axios.get(`http://localhost:8000/tasks/${taskId}`);
        if (statusRes.data.status === "success") {
          clearInterval(interval);
          setCompiling(false);
          // In real app, this is an S3 URL. 
          // Here we just say "Done" because we didn't setup a file server to serve the PDF back to browser
          alert("PDF Compiled Successfully! (Check backend /builds folder)");
        } else if (statusRes.data.status === "error") {
          clearInterval(interval);
          setCompiling(false);
          alert("Error: " + statusRes.data.log);
        }
      }, 1000);
    } catch (e) {
      setCompiling(false);
      alert("Compile failed");
    }
  };

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <div className="bg-gray-900 text-white p-3 flex justify-between items-center">
        <span className="font-bold">Overleaf Clone</span>
        <button 
          onClick={handleCompile}
          disabled={compiling}
          className="bg-green-600 px-4 py-1 rounded disabled:opacity-50"
        >
          {compiling ? "Compiling..." : "Recompile"}
        </button>
      </div>

      {/* Main Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Code Editor */}
        <div className="w-1/2 border-r border-gray-300 overflow-auto">
          <CodeMirror
            value={code}
            height="100%"
            extensions={[markdown({ base: markdownLanguage })]} // Use latex lang in prod
            onChange={onChange}
            theme="light"
          />
        </div>

        {/* PDF Preview (Placeholder) */}
        <div className="w-1/2 bg-gray-100 flex items-center justify-center">
            <p className="text-gray-500">
                PDF Preview Area <br/>
                (Configure MinIO/Nginx to serve generated PDFs here)
            </p>
        </div>
      </div>
    </div>
  );
}