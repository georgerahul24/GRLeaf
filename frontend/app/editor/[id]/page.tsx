"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  FileText,
  Play,
  Download,
  Users,
  AlertCircle,
  CheckCircle,
  Plus,
  X,
  File,
  ChevronRight,
  Share2,
  ArrowLeft,
} from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import axios from "axios";

import CodeMirror from "@uiw/react-codemirror";
import { StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { autocompletion } from "@codemirror/autocomplete";
import { authService } from "@/lib/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// LaTeX autocomplete suggestions
const latexCompletions = (context: any) => {
  const word = context.matchBefore(/\\[\w]*/);
  if (!word || (word.from == word.to && !context.explicit)) return null;

  const options = [
    // Document structure
    { label: "\\documentclass{}", detail: "Document class", apply: "\\documentclass{article}" },
    { label: "\\begin{}", detail: "Begin environment", apply: "\\begin{document}\n\t\n\\end{document}" },
    { label: "\\end{}", detail: "End environment" },
    { label: "\\section{}", detail: "Section" },
    { label: "\\subsection{}", detail: "Subsection" },
    { label: "\\subsubsection{}", detail: "Subsubsection" },
    { label: "\\chapter{}", detail: "Chapter" },
    { label: "\\title{}", detail: "Title" },
    { label: "\\author{}", detail: "Author" },
    { label: "\\date{}", detail: "Date" },
    { label: "\\maketitle", detail: "Make title" },
    { label: "\\tableofcontents", detail: "Table of contents" },
    
    // Text formatting
    { label: "\\textbf{}", detail: "Bold text" },
    { label: "\\textit{}", detail: "Italic text" },
    { label: "\\underline{}", detail: "Underline" },
    { label: "\\emph{}", detail: "Emphasis" },
    { label: "\\texttt{}", detail: "Typewriter text" },
    
    // Lists
    { label: "\\begin{itemize}", detail: "Bullet list", apply: "\\begin{itemize}\n\t\\item \n\\end{itemize}" },
    { label: "\\begin{enumerate}", detail: "Numbered list", apply: "\\begin{enumerate}\n\t\\item \n\\end{enumerate}" },
    { label: "\\item", detail: "List item" },
    
    // Math
    { label: "\\begin{equation}", detail: "Equation", apply: "\\begin{equation}\n\t\n\\end{equation}" },
    { label: "\\begin{align}", detail: "Align equations", apply: "\\begin{align}\n\t\n\\end{align}" },
    { label: "\\frac{}{}", detail: "Fraction" },
    { label: "\\sum", detail: "Summation" },
    { label: "\\int", detail: "Integral" },
    { label: "\\prod", detail: "Product" },
    { label: "\\sqrt{}", detail: "Square root" },
    { label: "\\alpha", detail: "Alpha" },
    { label: "\\beta", detail: "Beta" },
    { label: "\\gamma", detail: "Gamma" },
    { label: "\\delta", detail: "Delta" },
    { label: "\\epsilon", detail: "Epsilon" },
    { label: "\\theta", detail: "Theta" },
    { label: "\\lambda", detail: "Lambda" },
    { label: "\\mu", detail: "Mu" },
    { label: "\\pi", detail: "Pi" },
    { label: "\\sigma", detail: "Sigma" },
    { label: "\\omega", detail: "Omega" },
    
    // Figures and tables
    { label: "\\begin{figure}", detail: "Figure", apply: "\\begin{figure}[h]\n\t\\centering\n\t\\includegraphics{}\n\t\\caption{}\n\\end{figure}" },
    { label: "\\begin{table}", detail: "Table", apply: "\\begin{table}[h]\n\t\\centering\n\t\\begin{tabular}{}\n\t\t\n\t\\end{tabular}\n\t\\caption{}\n\\end{table}" },
    { label: "\\includegraphics{}", detail: "Include graphics" },
    { label: "\\caption{}", detail: "Caption" },
    { label: "\\label{}", detail: "Label" },
    { label: "\\ref{}", detail: "Reference" },
    
    // Packages
    { label: "\\usepackage{}", detail: "Use package" },
    { label: "\\usepackage{graphicx}", detail: "Graphics package", apply: "\\usepackage{graphicx}" },
    { label: "\\usepackage{amsmath}", detail: "AMS Math package", apply: "\\usepackage{amsmath}" },
    { label: "\\usepackage{hyperref}", detail: "Hyperref package", apply: "\\usepackage{hyperref}" },
  ];

  return {
    from: word.from,
    options: options.filter(opt => opt.label.toLowerCase().startsWith(word.text.toLowerCase())),
  };
};

interface FileItem {
  name: string;
  content: string;
  is_main: boolean;
}

export default function Editor() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [project, setProject] = useState<any>(null);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [currentFile, setCurrentFile] = useState<string>("main.tex");
  const [code, setCode] = useState("");
  const [ws, setWs] = useState<WebSocket | null>(null);

  const [compiling, setCompiling] = useState(false);
  const [connected, setConnected] = useState(false);
  const [compileStatus, setCompileStatus] = useState<"idle" | "success" | "error">("idle");
  
  const [showNewFileModal, setShowNewFileModal] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareEmail, setShareEmail] = useState("");
  const [shareLevel, setShareLevel] = useState("editor");
  const [collaborators, setCollaborators] = useState<any[]>([]);

  /**
   * ==============================
   * 1. AUTHENTICATION & INITIAL LOAD
   * ==============================
   */
  useEffect(() => {
    checkAuthAndLoad();
  }, [id]);

  const checkAuthAndLoad = async () => {
    const user = await authService.getMe();
    if (!user) {
      router.push("/login");
      return;
    }
    loadProject();
    loadCollaborators();
  };

  const loadProject = async () => {
    try {
      const res = await axios.get(`${API_URL}/projects/${id}`, {
        headers: authService.getAuthHeaders(),
      });
      setProject(res.data);
      setFiles(res.data.files || []);
      
      // Load first file or main.tex
      const mainFile = res.data.files?.find((f: FileItem) => f.is_main) || res.data.files?.[0];
      if (mainFile) {
        setCurrentFile(mainFile.name);
        setCode(mainFile.content);
        setupWebSocket(mainFile.name);
      }
    } catch (error) {
      console.error("Failed to load project:", error);
      alert("Failed to load project");
      router.push("/");
    }
  };

  const loadCollaborators = async () => {
    try {
      const res = await axios.get(`${API_URL}/projects/${id}/collaborators`, {
        headers: authService.getAuthHeaders(),
      });
      setCollaborators(res.data || []);
    } catch (error) {
      console.error("Failed to load collaborators:", error);
    }
  };

  /**
   * ==============================
   * 2. WEBSOCKET
   * ==============================
   */
  const setupWebSocket = (filename: string) => {
    if (ws) ws.close();

    const socket = new WebSocket(`ws://localhost:8000/ws/${id}/${filename}`);

    socket.onopen = () => setConnected(true);
    socket.onclose = () => setConnected(false);
    socket.onerror = () => setConnected(false);

    socket.onmessage = (event) => {
      setCode(event.data);
    };

    setWs(socket);
  };

  useEffect(() => {
    return () => {
      if (ws) ws.close();
    };
  }, [ws]);

  /**
   * ==============================
   * 3. FILE MANAGEMENT
   * ==============================
   */
  const switchFile = (filename: string) => {
    const file = files.find((f) => f.name === filename);
    if (file) {
      setCurrentFile(filename);
      setCode(file.content);
      setupWebSocket(filename);
    }
  };

  const createFile = async () => {
    if (!newFileName.trim()) return;
    
    const filename = newFileName.endsWith(".tex") ? newFileName : `${newFileName}.tex`;
    
    try {
      const res = await axios.post(
        `${API_URL}/projects/${id}/files`,
        { name: filename, content: "" },
        { headers: { "Content-Type": "application/json", ...authService.getAuthHeaders() } }
      );
      
      const newFile = res.data;
      setFiles([...files, newFile]);
      setShowNewFileModal(false);
      setNewFileName("");
      switchFile(filename);
    } catch (error: any) {
      alert(error.response?.data?.detail || "Failed to create file");
    }
  };

  const deleteFile = async (filename: string) => {
    if (!confirm(`Delete ${filename}?`)) return;
    
    try {
      await axios.delete(`${API_URL}/projects/${id}/files/${filename}`, {
        headers: authService.getAuthHeaders(),
      });
      
      const newFiles = files.filter((f) => f.name !== filename);
      setFiles(newFiles);
      
      if (currentFile === filename && newFiles.length > 0) {
        switchFile(newFiles[0].name);
      }
    } catch (error: any) {
      alert(error.response?.data?.detail || "Failed to delete file");
    }
  };

  const setMainFile = async (filename: string) => {
    try {
      await axios.put(
        `${API_URL}/projects/${id}/files/${filename}/set-main`,
        {},
        { headers: authService.getAuthHeaders() }
      );
      
      setFiles(files.map((f) => ({ ...f, is_main: f.name === filename })));
    } catch (error) {
      alert("Failed to set main file");
    }
  };

  /**
   * ==============================
   * 4. EDITOR
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
   * 5. COMPILE & DOWNLOAD
   * ==============================
   */
  const handleCompile = async () => {
    setCompiling(true);
    setCompileStatus("idle");

    try {
      const res = await axios.post(
        `${API_URL}/projects/${id}/compile`,
        {},
        { headers: authService.getAuthHeaders() }
      );

      const taskId = res.data.task_id;

      const interval = setInterval(async () => {
        const statusRes = await axios.get(`${API_URL}/tasks/${taskId}`);

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
    } catch (error) {
      setCompiling(false);
      setCompileStatus("error");
      alert("Compilation request failed");
    }
  };

  const handleDownload = async () => {
    try {
      const res = await axios.get(`${API_URL}/projects/${id}/download`, {
        headers: authService.getAuthHeaders(),
        responseType: "blob",
      });

      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `${project?.name || "document"}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error: any) {
      alert(error.response?.data?.detail || "Please compile the document first");
    }
  };

  /**
   * ==============================
   * 6. SHARING
   * ==============================
   */
  const shareProject = async () => {
    if (!shareEmail.trim()) return;

    try {
      await axios.post(
        `${API_URL}/projects/${id}/share`,
        { user_email: shareEmail, access_level: shareLevel },
        { headers: { "Content-Type": "application/json", ...authService.getAuthHeaders() } }
      );

      setShareEmail("");
      setShowShareModal(false);
      loadCollaborators();
      alert("Project shared successfully");
    } catch (error: any) {
      alert(error.response?.data?.detail || "Failed to share project");
    }
  };

  if (!project) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-green-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading project...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      {/* ================= HEADER ================= */}
      <header className="bg-white border-b shadow-sm">
        <div className="px-6 py-3 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/")}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <FileText className="w-6 h-6 text-green-600" />
            <span className="font-bold text-xl">{project.name}</span>
          </div>

          <div className="flex items-center gap-4">
            {/* Collaborators */}
            <button
              onClick={() => setShowShareModal(true)}
              className="flex items-center gap-2 px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              <Users className="w-4 h-4" />
              <span className="text-sm">{collaborators.length}</span>
              <Share2 className="w-4 h-4" />
            </button>

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
              className="px-4 py-2 rounded-lg hover:bg-gray-100 transition-colors"
              title="Download PDF"
            >
              <Download className="w-4 h-4" />
            </button>

            {/* Compile */}
            <button
              onClick={handleCompile}
              disabled={compiling}
              className="flex items-center gap-2 px-5 py-2 bg-green-600 text-white rounded-lg disabled:opacity-60 hover:bg-green-700 transition-colors"
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
                Compilation successful - PDF ready for download
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
        {/* ===== FILE SIDEBAR ===== */}
        <div className="w-64 bg-white border-r flex flex-col">
          <div className="px-4 py-3 border-b flex justify-between items-center">
            <span className="text-sm font-semibold text-gray-700">Files</span>
            <button
              onClick={() => setShowNewFileModal(true)}
              className="p-1.5 hover:bg-gray-100 rounded transition-colors"
              title="New file"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {files.map((file) => (
              <div
                key={file.name}
                className={`flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors ${
                  currentFile === file.name ? "bg-green-50 border-l-4 border-green-600" : ""
                }`}
                onClick={() => switchFile(file.name)}
              >
                <div className="flex items-center gap-2 flex-1">
                  <File className="w-4 h-4 text-gray-500" />
                  <span className="text-sm text-gray-700">{file.name}</span>
                  {file.is_main && (
                    <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">
                      main
                    </span>
                  )}
                </div>
                
                <div className="flex items-center gap-1">
                  {!file.is_main && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setMainFile(file.name);
                      }}
                      className="p-1 hover:bg-gray-200 rounded text-xs text-gray-600"
                      title="Set as main"
                    >
                      <ChevronRight className="w-3 h-3" />
                    </button>
                  )}
                  {files.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteFile(file.name);
                      }}
                      className="p-1 hover:bg-red-100 rounded"
                      title="Delete"
                    >
                      <X className="w-3 h-3 text-red-600" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ===== CODE EDITOR ===== */}
        <div className="flex-1 bg-white flex flex-col">
          <div className="px-4 py-2 border-b text-sm font-semibold bg-gray-50">
            {currentFile}
          </div>

          <div className="flex-1 overflow-hidden">
            <CodeMirror
              value={code}
              height="100%"
              extensions={[
                StreamLanguage.define(stex),
                autocompletion({ override: [latexCompletions] }),
              ]}
              onChange={onChange}
              className="h-full text-base"
            />
          </div>
        </div>
      </div>

      {/* ================= NEW FILE MODAL ================= */}
      {showNewFileModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">New File</h2>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                File Name
              </label>
              <input
                type="text"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && createFile()}
                placeholder="example.tex"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                autoFocus
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowNewFileModal(false);
                  setNewFileName("");
                }}
                className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createFile}
                disabled={!newFileName.trim()}
                className="flex-1 px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= SHARE MODAL ================= */}
      {showShareModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">Share Project</h2>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Email
              </label>
              <input
                type="email"
                value={shareEmail}
                onChange={(e) => setShareEmail(e.target.value)}
                placeholder="user@example.com"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Access Level
              </label>
              <select
                value={shareLevel}
                onChange={(e) => setShareLevel(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="viewer">Viewer (can view)</option>
                <option value="editor">Editor (can edit)</option>
                <option value="owner">Owner (full access)</option>
              </select>
            </div>

            {/* Current Collaborators */}
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">
                Current Collaborators
              </h3>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {collaborators.map((collab, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg"
                  >
                    <div>
                      <div className="text-sm font-medium text-gray-800">
                        {collab.user.name || collab.user.email}
                      </div>
                      <div className="text-xs text-gray-500">{collab.user.email}</div>
                    </div>
                    <span className="text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded">
                      {collab.access_level}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowShareModal(false);
                  setShareEmail("");
                }}
                className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Close
              </button>
              <button
                onClick={shareProject}
                disabled={!shareEmail.trim()}
                className="flex-1 px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                Share
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
