"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { FileText, Plus, Search, Grid, List, Clock, Users, Trash2, Star, FolderOpen, LogOut } from "lucide-react";
import { authService } from "@/lib/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function Dashboard() {
  const router = useRouter();
  const [projects, setProjects] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState("grid");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const currentUser = await authService.getMe();
    if (!currentUser) {
      router.push("/login");
      return;
    }
    setUser(currentUser);
    fetchProjects();
  };

  const fetchProjects = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/projects`, {
        headers: authService.getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setProjects(data);
    } catch (error) {
      console.error("Error fetching projects:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await authService.logout();
    router.push("/login");
  };

  const filteredProjects = projects.filter(p => 
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const createProject = async () => {
    if (!newProjectName.trim()) return;
    
    try {
      const res = await fetch(`${API_URL}/projects`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authService.getAuthHeaders(),
        },
        body: JSON.stringify({ name: newProjectName }),
      });
      if (!res.ok) throw new Error("Failed to create");
      const data = await res.json();
      
      // Navigate to editor
      router.push(`/editor/${data.id}`);
    } catch (error) {
      console.error("Error creating project:", error);
      alert("Failed to create project");
    }
  };

  const toggleStar = async (id, e) => {
    e.stopPropagation();
    setProjects(projects.map(p => 
      p._id === id ? { ...p, starred: !p.starred } : p
    ));
  };

  const deleteProject = async (id, e) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this project?")) return;
    
    try {
      const res = await fetch(`${API_URL}/projects/${id}`, {
        method: "DELETE",
        headers: authService.getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to delete");
      setProjects(projects.filter(p => p._id !== id));
    } catch (error) {
      console.error("Error deleting project:", error);
      alert("Failed to delete project");
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return "Recently";
    const date = new Date(dateStr);
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);
    
    if (diffInHours < 24) return "Today";
    if (diffInHours < 48) return "Yesterday";
    if (diffInHours < 168) return `${Math.floor(diffInHours / 24)} days ago`;
    return date.toLocaleDateString();
  };

  const openProject = (id) => {
    router.push(`/editor/${id}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-green-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading projects...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-600 rounded-lg flex items-center justify-center">
                <FileText className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-800">GRLeaf</h1>
                <p className="text-sm text-gray-500">
                  {user ? `Welcome, ${user.name || user.email}` : "Collaborative LaTeX editing"}
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              {user?.is_admin && (
                <button
                  onClick={() => router.push("/admin")}
                  className="flex items-center gap-2 px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-all font-medium"
                  title="Admin Dashboard"
                >
                  <Users className="w-5 h-5" />
                  Admin
                </button>
              )}
              <button 
                onClick={() => setShowCreateModal(true)}
                className="flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-all shadow-sm hover:shadow font-medium"
              >
                <Plus className="w-5 h-5" />
                New Project
              </button>
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 px-4 py-2.5 border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg transition-all font-medium"
              >
                <LogOut className="w-5 h-5" />
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Search and Filters */}
        <div className="mb-8 flex items-center justify-between gap-4">
          <div className="flex-1 max-w-md relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search projects..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-11 pr-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
            />
          </div>
          
          <div className="flex items-center gap-2 bg-white rounded-lg border border-gray-300 p-1">
            <button
              onClick={() => setViewMode("grid")}
              className={`p-2 rounded transition-colors ${
                viewMode === "grid" ? "bg-green-100 text-green-700" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              <Grid className="w-5 h-5" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`p-2 rounded transition-colors ${
                viewMode === "list" ? "bg-green-100 text-green-700" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              <List className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Projects Count */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-700">
            {filteredProjects.length} {filteredProjects.length === 1 ? "Project" : "Projects"}
          </h2>
        </div>

        {/* Projects Grid/List */}
        {filteredProjects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <FolderOpen className="w-20 h-20 text-gray-300 mb-4" />
            <h3 className="text-xl font-semibold text-gray-600 mb-2">No projects found</h3>
            <p className="text-gray-500 mb-6">
              {searchQuery ? "Try a different search term" : "Create your first project to get started"}
            </p>
            {!searchQuery && (
              <button 
                onClick={() => setShowCreateModal(true)}
                className="flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-all"
              >
                <Plus className="w-5 h-5" />
                Create Project
              </button>
            )}
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredProjects.map((project) => (
              <div 
                key={project._id}
                onClick={() => openProject(project._id)}
                className="group bg-white rounded-xl border border-gray-200 p-6 cursor-pointer hover:shadow-lg hover:border-green-300 transition-all relative"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="w-12 h-12 bg-green-50 rounded-lg flex items-center justify-center group-hover:bg-green-100 transition-colors">
                    <FileText className="w-6 h-6 text-green-600" />
                  </div>
                  
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => toggleStar(project._id, e)}
                      className="p-1.5 rounded hover:bg-gray-100 transition-colors"
                    >
                      <Star 
                        className={`w-5 h-5 ${
                          project.starred ? "fill-yellow-400 text-yellow-400" : "text-gray-400"
                        }`}
                      />
                    </button>
                    <button
                      onClick={(e) => deleteProject(project._id, e)}
                      className="p-1.5 rounded hover:bg-red-50 transition-colors"
                    >
                      <Trash2 className="w-5 h-5 text-gray-400 hover:text-red-600" />
                    </button>
                  </div>
                </div>
                
                <h3 className="text-lg font-semibold text-gray-800 mb-3 group-hover:text-green-600 transition-colors">
                  {project.name}
                </h3>
                
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Clock className="w-4 h-4" />
                    <span>{formatDate(project.updated_at)}</span>
                  </div>
                  
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Users className="w-4 h-4" />
                    <span>{project.collaborators || 1} {(project.collaborators || 1) === 1 ? "collaborator" : "collaborators"}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {filteredProjects.map((project, index) => (
              <div 
                key={project._id}
                onClick={() => openProject(project._id)}
                className={`flex items-center justify-between p-5 cursor-pointer hover:bg-gray-50 transition-colors ${
                  index !== filteredProjects.length - 1 ? "border-b border-gray-200" : ""
                }`}
              >
                <div className="flex items-center gap-4 flex-1">
                  <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center">
                    <FileText className="w-5 h-5 text-green-600" />
                  </div>
                  
                  <div className="flex-1">
                    <h3 className="text-base font-semibold text-gray-800 mb-1">{project.name}</h3>
                    <div className="flex items-center gap-4 text-sm text-gray-500">
                      <span className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        {formatDate(project.updated_at)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="w-4 h-4" />
                        {project.collaborators || 1}
                      </span>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => toggleStar(project._id, e)}
                    className="p-2 rounded hover:bg-gray-100 transition-colors"
                  >
                    <Star 
                      className={`w-5 h-5 ${
                        project.starred ? "fill-yellow-400 text-yellow-400" : "text-gray-400"
                      }`}
                    />
                  </button>
                  <button
                    onClick={(e) => deleteProject(project._id, e)}
                    className="p-2 rounded hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="w-5 h-5 text-gray-400 hover:text-red-600" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Create Project Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">Create New Project</h2>
            
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Project Name
              </label>
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && createProject()}
                placeholder="Enter project name..."
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                autoFocus
              />
            </div>
            
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setNewProjectName("");
                }}
                className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={createProject}
                disabled={!newProjectName.trim()}
                className="flex-1 px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed font-medium"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}