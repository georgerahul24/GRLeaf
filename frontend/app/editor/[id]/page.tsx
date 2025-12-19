"use client";

import React, { useState, useEffect, useCallback } from "react";
import { FileText, Play, Download, Users, AlertCircle, CheckCircle } from "lucide-react";
import { useParams } from "next/navigation";
import axios from "axios";

import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";

export default function Editor() {
  const params = useParams();
  const id = params.id as string;

  const [code, setCode] = useState("");
  const [ws, setWs] = useState<WebSocket | null>(null);

  const [compiling, setCompiling] = useState(false);
  const [connected, setConnected] = useState(false);
  const [collaborators, setCollaborators] = useState(1); // backend can update later
  const [compileStatus, setCompileStatus] = useState<"idle" | "success" | "error">("idle");

  /**
   * ==============================
   * 1. INITIAL LOAD + WEBSOCKET
   * ==============================
   */
  useEffect(() => {
    // Fetch initial document
    axios
      .get(`http://localhost:8000/projects/${id}`)
      .then((res) => setCode(res.data.content))
      .catch(() => alert("Failed to load document"));

    // WebSocket setup
    const socket = new WebSocket(`ws://localhost:8000/ws/${id}`);

    socket.onopen = () => setConnected(true);
    socket.onclose = () => setConnected(false);
    socket.onerror = () => setConnected(false);

    socket.onmessage = (event) => {
      // Remote update from collaborator
      setCode(event.data);
    };

    setWs(socket);

    return () => socket.close();
  }, [id]);

  /**
   * ==============================
   * 2. EDIT HANDLER (REAL-TIME)
   * ==============================
   */
  const onChange = useCallback(
    (value: string) => {
      setCode(value);

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(value);
      }
    },
    [ws]
  );

  /**
   * ==============================
   * 3. COMPILE (REAL API)
   * ==============================
   */
  const handleCompile = async () => {
    setCompiling(true);
    setCompileStatus("idle");

    try {
      const res = await axios.post(
        `http://localhost:8000/projects/${id}/compile`
      );

      const taskId = res.data.task_id;

      const interval = setInterval(async () => {
        const statusRes = await axios.get(
          `http://localhost:8000/tasks/${taskId}`
        );

        if (statusRes.data.status === "success") {
          clearInterval(interval);
          setCompiling(false);
          setCompileStatus("success");
        }

        if (statusRes.data.status === "error") {
          clearInterval(interval);
          setCompiling(false);
          setCompileStatus("error");
          alert(statusRes.data.log);
        }
      }, 1000);
    } catch {
      setCompiling(false);
      setCompileStatus("error");
      alert("Compilation request failed");
    }
  };

  /**
   * ==============================
   * 4. DOWNLOAD (REALISTIC HOOK)
   * ==============================
   * Wire this to MinIO/Nginx later
   */
  const handleDownload = () => {
    alert("Serve compiled PDF via Nginx/MinIO");
  };

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      {/* ================= HEADER ================= */}
      <header className="bg-white border-b shadow-sm">
        <div className="px-6 py-3 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <FileText className="w-6 h-6 text-green-600" />
            <span className="font-bold text-xl">Overleaf Clone</span>
          </div>

          <div className="flex items-center gap-4">
            {/* Collaborators */}
            <div className="flex items-center gap-2 px-3 py-1 bg-gray-100 rounded-lg">
              <Users className="w-4 h-4" />
              <span className="text-sm">{collaborators}</span>
            </div>

            {/* Connection Status */}
            <div
              className={`flex items-center gap-2 px-3 py-1 rounded-lg ${
                connected
                  ? "bg-green-50 text-green-700"
                  : "bg-red-50 text-red-700"
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  connected ? "bg-green-500" : "bg-red-500"
                }`}
              />
              <span className="text-xs">
                {connected ? "Connected" : "Disconnected"}
              </span>
            </div>

            {/* Download */}
            <button
              onClick={handleDownload}
              className="px-4 py-2 rounded-lg hover:bg-gray-100"
            >
              <Download className="w-4 h-4" />
            </button>

            {/* Compile */}
            <button
              onClick={handleCompile}
              disabled={compiling}
              className="flex items-center gap-2 px-5 py-2 bg-green-600 text-white rounded-lg disabled:opacity-60"
            >
              <Play className="w-4 h-4" />
              {compiling ? "Compiling..." : "Recompile"}
            </button>
          </div>
        </div>

        {/* Compile Status */}
        {compileStatus !== "idle" && (
          <div
            className={`px-6 py-2 text-sm flex items-center gap-2 ${
              compileStatus === "success"
                ? "bg-green-50 text-green-800"
                : "bg-red-50 text-red-800"
            }`}
          >
            {compileStatus === "success" ? (
              <>
                <CheckCircle className="w-4 h-4" />
                Compilation successful
              </>
            ) : (
              <>
                <AlertCircle className="w-4 h-4" />
                Compilation failed
              </>
            )}
          </div>
        )}
      </header>

      {/* ================= MAIN ================= */}
      <div className="flex flex-1 overflow-hidden">
        {/* ===== CODE EDITOR ===== */}
        <div className="w-1/2 border-r bg-white">
          <div className="px-4 py-2 border-b text-sm font-semibold">
            Source
          </div>

          <CodeMirror
            value={code}
            height="100%"
            extensions={[markdown()]}
            onChange={onChange}
          />
        </div>

        {/* ===== PDF PREVIEW ===== */}
        <div className="w-1/2 bg-gray-100 flex flex-col">
          <div className="px-4 py-2 border-b text-sm font-semibold">
            Preview
          </div>

          <div className="flex-1 flex items-center justify-center text-gray-500">
            PDF Preview Area  
            <br />
            (Serve compiled PDFs via MinIO + Nginx)
          </div>
        </div>
      </div>
    </div>
  );
}
