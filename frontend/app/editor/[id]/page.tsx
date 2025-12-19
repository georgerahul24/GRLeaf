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
  ZoomIn,
  ZoomOut,
  Maximize2,
  Columns,
  Eye,
  EyeOff,
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
const latexCompletions = (context: any, projectFiles: FileItem[] = []) => {
  const word = context.matchBefore(/\\[\w]*/);
  if (!word || (word.from == word.to && !context.explicit)) return null;

  // Add file paths for \input{} and \include{}
  const filePathOptions = projectFiles.map(file => ({
    label: `\\input{${file.name.replace('.tex', '')}}`,
    detail: `Include ${file.name}`,
    apply: `\\input{${file.name.replace('.tex', '')}}`
  }));

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
    
    // File inclusion
    { label: "\\input{}", detail: "Include another LaTeX file" },
    { label: "\\include{}", detail: "Include file (with page break)" },
  ];

  return {
    from: word.from,
    options: [...options, ...filePathOptions].filter(opt => opt.label.toLowerCase().startsWith(word.text.toLowerCase())),
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
  const [errorLog, setErrorLog] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"editor" | "errors">("editor");
  
  const [showNewFileModal, setShowNewFileModal] = useState(false);
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [showToolbar, setShowToolbar] = useState(true);
  const [newFileName, setNewFileName] = useState("");
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareEmail, setShareEmail] = useState("");
  const [shareLevel, setShareLevel] = useState("editor");
  const [collaborators, setCollaborators] = useState<any[]>([]);
  
  // PDF Preview
  const [pdfUrl, setPdfUrl] = useState<string>("");
  const [showPdf, setShowPdf] = useState(true);
  const [pdfZoom, setPdfZoom] = useState(100);
  const [viewMode, setViewMode] = useState<"split" | "editor" | "pdf">("split");

  /**
   * ==============================
   * 1. AUTHENTICATION & INITIAL LOAD
   * ==============================
   */
  useEffect(() => {
    checkAuthAndLoad();
  }, [id]);

  // Ctrl+S handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSaveAndCompile();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [code]);

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
    if (ws) {
      ws.close();
      setConnected(false);
    }

    const socket = new WebSocket(`ws://localhost:8000/ws/${id}/${filename}`);

    socket.onopen = () => {
      console.log('WebSocket connected');
      setConnected(true);
    };
    socket.onclose = () => {
      console.log('WebSocket closed');
      setConnected(false);
    };
    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
      setConnected(false);
    };

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

  const createFolder = async () => {
    if (!newFolderName.trim()) return;
    
    // Create a folder by creating a .gitkeep file in it
    const folderPath = newFolderName.endsWith('/') ? newFolderName : `${newFolderName}/`;
    const filename = `${folderPath}.gitkeep`;
    
    try {
      await axios.post(
        `${API_URL}/projects/${id}/files`,
        { name: filename, content: "" },
        { headers: { "Content-Type": "application/json", ...authService.getAuthHeaders() } }
      );
      
      await loadProject();
      setShowNewFolderModal(false);
      setNewFolderName("");
    } catch (error: any) {
      alert(error.response?.data?.detail || "Failed to create folder");
    }
  };

  const handleImageDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    
    for (const imageFile of imageFiles) {
      // Read file as base64
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64 = event.target?.result as string;
        const filename = `images/${imageFile.name}`;
        
        try {
          // Create the image file in the project
          await axios.post(
            `${API_URL}/projects/${id}/files`,
            { name: filename, content: base64 },
            { headers: { "Content-Type": "application/json", ...authService.getAuthHeaders() } }
          );
          
          // Insert LaTeX code for the image
          const imageCode = `\n\\begin{figure}[h]\n\\centering\n\\includegraphics[width=0.8\\textwidth]{${filename}}\n\\caption{${imageFile.name}}\n\\end{figure}\n`;
          setCode(code + imageCode);
          
          await loadProject();
        } catch (error) {
          console.error("Failed to upload image:", error);
        }
      };
      reader.readAsDataURL(imageFile);
    }
  };

  const insertLatexCommand = (command: string) => {
    setCode(code + command);
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
  const handleSaveAndCompile = async () => {
    // Save current file
    try {
      await axios.put(
        `${API_URL}/projects/${id}/files/${currentFile}`,
        { content: code },
        { headers: { "Content-Type": "application/json", ...authService.getAuthHeaders() } }
      );
    } catch (error) {
      console.error("Save failed:", error);
    }
    
    // Trigger compile
    await handleCompile();
  };

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
          // Refresh PDF preview
          refreshPdfPreview();
        }

        if (statusRes.data.status === "error") {
          clearInterval(interval);
          setCompiling(false);
          setCompileStatus("error");
          setErrorLog(statusRes.data.log || "Compilation failed");
          setActiveTab("errors");
        }
      }, 1000);
    } catch (error: any) {
      setCompiling(false);
      setCompileStatus("error");
      setErrorLog(error.response?.data?.detail || "Compilation request failed");
      setActiveTab("errors");
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

  const refreshPdfPreview = async () => {
    try {
      const res = await axios.get(`${API_URL}/projects/${id}/download`, {
        headers: authService.getAuthHeaders(),
        responseType: "blob",
      });

      // Create blob URL from the response
      const blob = new Blob([res.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);
      
      // Revoke old URL if exists
      if (pdfUrl) {
        window.URL.revokeObjectURL(pdfUrl);
      }
      
      setPdfUrl(url);
    } catch (error) {
      console.error("Failed to load PDF preview:", error);
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

            {/* View Mode Selector */}
            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setViewMode("editor")}
                className={`p-2 rounded transition-colors ${viewMode === "editor" ? "bg-white shadow" : "hover:bg-gray-200"}`}
                title="Editor only"
              >
                <File className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode("split")}
                className={`p-2 rounded transition-colors ${viewMode === "split" ? "bg-white shadow" : "hover:bg-gray-200"}`}
                title="Split view"
              >
                <Columns className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode("pdf")}
                className={`p-2 rounded transition-colors ${viewMode === "pdf" ? "bg-white shadow" : "hover:bg-gray-200"}`}
                title="PDF only"
              >
                <FileText className="w-4 h-4" />
              </button>
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
              title="Ctrl+S to save and compile"
            >
              <Play className="w-4 h-4" />
              {compiling ? "Compiling..." : "Recompile"}
            </button>
          </div>
        </div>

        {/* No more compile status banner - errors go to error tab */}
      </header>

      {/* ================= MAIN ================= */}
      <div className="flex flex-1 overflow-hidden">
        {/* ===== FILE SIDEBAR ===== */}
        {viewMode !== "pdf" && (
        <div className="w-64 bg-white border-r flex flex-col">
          <div className="px-4 py-3 border-b">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-semibold text-gray-700">Files & Folders</span>
              <div className="flex gap-1">
                <button
                  onClick={() => setShowNewFolderModal(true)}
                  className="p-1.5 hover:bg-gray-100 rounded transition-colors"
                  title="New folder"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                  </svg>
                </button>
                <button
                  onClick={() => setShowNewFileModal(true)}
                  className="p-1.5 hover:bg-gray-100 rounded transition-colors"
                  title="New file"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-500">
              Set one file as <span className="font-semibold">MAIN</span> to compile. Use <code className="bg-gray-100 px-1 rounded">\input{"{filename}"}</code> to include others. Drag & drop images here.
            </p>
          </div>

          <div className="flex-1 overflow-y-auto">
            {(() => {
              // Group files by folder
              const fileTree: any = {};
              files.forEach(file => {
                const parts = file.name.split('/');
                if (parts.length === 1) {
                  // Root level file
                  if (!fileTree['__root__']) fileTree['__root__'] = [];
                  fileTree['__root__'].push(file);
                } else {
                  // File in folder
                  const folder = parts.slice(0, -1).join('/');
                  if (!fileTree[folder]) fileTree[folder] = [];
                  fileTree[folder].push(file);
                }
              });

              return (
                <>
                  {/* Root files */}
                  {fileTree['__root__']?.map((file: FileItem) => (
                    <div
                      key={file.name}
                      className={`group flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors ${
                        currentFile === file.name ? "bg-green-50 border-l-4 border-green-600" : ""
                      }`}
                      onClick={() => switchFile(file.name)}
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <File className="w-4 h-4 text-gray-500 flex-shrink-0" />
                        <span className="text-sm text-gray-700 truncate">{file.name}</span>
                        {file.is_main && (
                          <span className="text-xs bg-green-600 text-white px-2 py-0.5 rounded font-medium flex-shrink-0">
                            MAIN
                          </span>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {!file.is_main && file.name.endsWith('.tex') && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setMainFile(file.name);
                            }}
                            className="px-2 py-1 text-xs bg-green-100 hover:bg-green-200 text-green-700 rounded transition-colors font-medium"
                            title="Set as main compilation file"
                          >
                            Set Main
                          </button>
                        )}
                        {files.length > 1 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteFile(file.name);
                            }}
                            className="p-1 hover:bg-red-100 rounded"
                            title="Delete file"
                          >
                            <X className="w-3 h-3 text-red-600" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  
                  {/* Folders */}
                  {Object.keys(fileTree).filter(k => k !== '__root__').sort().map(folder => (
                    <div key={folder} className="mt-2">
                      <div className="px-4 py-1.5 bg-gray-50 border-t border-b border-gray-200">
                        <div className="flex items-center gap-2">
                          <svg className="w-4 h-4 text-yellow-600" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                          </svg>
                          <span className="text-xs font-semibold text-gray-700">{folder}</span>
                        </div>
                      </div>
                      {fileTree[folder].map((file: FileItem) => (
                        <div
                          key={file.name}
                          className={`group flex items-center justify-between pl-8 pr-4 py-2 cursor-pointer hover:bg-gray-50 transition-colors ${
                            currentFile === file.name ? "bg-green-50 border-l-4 border-green-600" : ""
                          }`}
                          onClick={() => switchFile(file.name)}
                        >
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <File className="w-4 h-4 text-gray-500 flex-shrink-0" />
                            <span className="text-sm text-gray-700 truncate">{file.name.split('/').pop()}</span>
                            {file.is_main && (
                              <span className="text-xs bg-green-600 text-white px-2 py-0.5 rounded font-medium flex-shrink-0">
                                MAIN
                              </span>
                            )}
                          </div>
                          
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {!file.is_main && file.name.endsWith('.tex') && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setMainFile(file.name);
                                }}
                                className="px-2 py-1 text-xs bg-green-100 hover:bg-green-200 text-green-700 rounded transition-colors font-medium"
                                title="Set as main compilation file"
                              >
                                Set Main
                              </button>
                            )}
                            {files.length > 1 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteFile(file.name);
                                }}
                                className="p-1 hover:bg-red-100 rounded"
                                title="Delete file"
                              >
                                <X className="w-3 h-3 text-red-600" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </>
              );
            })()}
          </div>
        </div>
        )}

        {/* ===== CODE EDITOR ===== */}
        {viewMode !== "pdf" && (
        <div className={`bg-white flex flex-col ${viewMode === "split" ? "flex-1" : "w-full"} relative`}>
          <div className="px-4 py-2 border-b bg-gray-50 flex justify-between items-center">
            <div className="flex gap-4">
              <button
                onClick={() => setActiveTab("editor")}
                className={`text-sm font-semibold px-3 py-1 rounded transition-colors ${
                  activeTab === "editor" ? "bg-white shadow text-green-600" : "text-gray-600 hover:text-gray-800"
                }`}
              >
                {currentFile}
              </button>
              <button
                onClick={() => setActiveTab("errors")}
                className={`text-sm font-semibold px-3 py-1 rounded transition-colors flex items-center gap-2 ${
                  activeTab === "errors" ? "bg-white shadow text-green-600" : "text-gray-600 hover:text-gray-800"
                }`}
              >
                Errors & Logs
                {compileStatus === "error" && (
                  <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                )}
              </button>
            </div>
            <span className="text-xs text-gray-500">Press Ctrl+S to save and compile</span>
          </div>

          <div className="flex-1 overflow-hidden">
            {activeTab === "editor" ? (
              <>
                <CodeMirror
                  value={code}
                  height="100%"
                  extensions={[
                    StreamLanguage.define(stex),
                    autocompletion({ override: [(ctx) => latexCompletions(ctx, files)] }),
                  ]}
                  onChange={onChange}
                  onDrop={handleImageDrop}
                  className="h-full text-base"
                />
                
                {/* Floating Toolbar */}
                {showToolbar && (
                  <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 bg-white shadow-xl rounded-lg border border-gray-200 p-2 flex items-center gap-1 z-10">
                    <button
                      onClick={() => insertLatexCommand("\\textbf{}")}
                      className="p-2 hover:bg-gray-100 rounded transition-colors"
                      title="Bold"
                    >
                      <strong className="text-sm">B</strong>
                    </button>
                    <button
                      onClick={() => insertLatexCommand("\\textit{}")}
                      className="p-2 hover:bg-gray-100 rounded transition-colors"
                      title="Italic"
                    >
                      <em className="text-sm">I</em>
                    </button>
                    <button
                      onClick={() => insertLatexCommand("\\underline{}")}
                      className="p-2 hover:bg-gray-100 rounded transition-colors"
                      title="Underline"
                    >
                      <span className="text-sm underline">U</span>
                    </button>
                    <div className="w-px h-6 bg-gray-300 mx-1"></div>
                    <button
                      onClick={() => insertLatexCommand("\\begin{itemize}\\n\\item \\n\\end{itemize}")}
                      className="p-2 hover:bg-gray-100 rounded transition-colors"
                      title="Bullet list"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                      </svg>
                    </button>
                    <button
                      onClick={() => insertLatexCommand("\\begin{enumerate}\\n\\item \\n\\end{enumerate}")}
                      className="p-2 hover:bg-gray-100 rounded transition-colors"
                      title="Numbered list"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                    </button>
                    <div className="w-px h-6 bg-gray-300 mx-1"></div>
                    <button
                      onClick={() => insertLatexCommand("\\begin{figure}[h]\\n\\centering\\n\\includegraphics[width=0.8\\textwidth]{}\\n\\caption{}\\n\\end{figure}\\n")}
                      className="p-2 hover:bg-gray-100 rounded transition-colors"
                      title="Insert image"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => insertLatexCommand("\\begin{equation}\\n\\n\\end{equation}")}
                      className="p-2 hover:bg-gray-100 rounded transition-colors"
                      title="Equation"
                    >
                      <span className="text-sm font-mono">Σ</span>
                    </button>
                    <div className="w-px h-6 bg-gray-300 mx-1"></div>
                    <button
                      onClick={() => setShowToolbar(false)}
                      className="p-2 hover:bg-gray-100 rounded transition-colors"
                      title="Hide toolbar"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
                
                {/* Show toolbar button when hidden */}
                {!showToolbar && (
                  <button
                    onClick={() => setShowToolbar(true)}
                    className="absolute bottom-6 left-1/2 transform -translate-x-1/2 bg-white shadow-lg rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 transition-colors z-10"
                  >
                    Show Toolbar
                  </button>
                )}
              </>
            ) : (
              <div className="h-full overflow-auto bg-gray-900 text-gray-100 p-4 font-mono text-sm">
                {errorLog ? (
                  <pre className="whitespace-pre-wrap">{errorLog}</pre>
                ) : (
                  <div className="text-center text-gray-500 mt-8">
                    <CheckCircle className="w-12 h-12 mx-auto mb-3 text-green-500" />
                    <p>No errors. Compilation log will appear here.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        )}

        {/* ===== PDF PREVIEW ===== */}
        {viewMode !== "editor" && (
        <div className={`bg-gray-100 flex flex-col ${viewMode === "split" ? "flex-1" : "w-full"}`}>
          <div className="px-4 py-2 border-b bg-gray-50 flex justify-between items-center">
            <span className="text-sm font-semibold">PDF Preview</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPdfZoom(Math.max(50, pdfZoom - 10))}
                className="p-1.5 hover:bg-gray-200 rounded"
                title="Zoom out"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-xs text-gray-600 min-w-[50px] text-center">{pdfZoom}%</span>
              <button
                onClick={() => setPdfZoom(Math.min(200, pdfZoom + 10))}
                className="p-1.5 hover:bg-gray-200 rounded"
                title="Zoom in"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPdfZoom(100)}
                className="px-2 py-1 text-xs hover:bg-gray-200 rounded"
              >
                Reset
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto p-4 bg-gray-200">
            {pdfUrl ? (
              <iframe
                src={pdfUrl}
                className="w-full h-full bg-white shadow-lg"
                style={{ transform: `scale(${pdfZoom / 100})`, transformOrigin: 'top left' }}
                title="PDF Preview"
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-gray-500">
                <FileText className="w-16 h-16 mb-4 text-gray-400" />
                <p className="text-lg font-medium mb-2">No PDF generated yet</p>
                <p className="text-sm">Click Recompile or press Ctrl+S to generate PDF</p>
              </div>
            )}
          </div>
        </div>
        )}
      </div>

      {/* ================= NEW FILE MODAL ================= */}
      {showNewFileModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">New File</h2>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                File Name (with path)
              </label>
              <input
                type="text"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && createFile()}
                placeholder="example.tex or folder/file.tex"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                autoFocus
              />
              <p className="text-xs text-gray-500 mt-1">Tip: Use folder/file.tex to create files in folders</p>
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

      {/* ================= NEW FOLDER MODAL ================= */}
      {showNewFolderModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">New Folder</h2>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Folder Name
              </label>
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && createFolder()}
                placeholder="images or sections/intro"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                autoFocus
              />
              <p className="text-xs text-gray-500 mt-1">Create folders to organize your project files</p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowNewFolderModal(false);
                  setNewFolderName("");
                }}
                className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createFolder}
                disabled={!newFolderName.trim()}
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
