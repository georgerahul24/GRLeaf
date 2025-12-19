"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Users,
  FileText,
  Download,
  Upload,
  Trash2,
  Shield,
  ShieldOff,
  ArrowLeft,
  Activity,
  Database,
} from "lucide-react";
import { authService } from "@/lib/auth";
import axios from "axios";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function AdminDashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<"users" | "projects" | "backup">("users");

  useEffect(() => {
    checkAdminAndLoad();
  }, []);

  const checkAdminAndLoad = async () => {
    const user = await authService.getMe();
    if (!user) {
      router.push("/login");
      return;
    }
    if (!user.is_admin) {
      alert("Admin access required");
      router.push("/");
      return;
    }
    loadData();
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const headers = authService.getAuthHeaders();

      const [usersRes, projectsRes, statsRes] = await Promise.all([
        axios.get(`${API_URL}/admin/users`, { headers }),
        axios.get(`${API_URL}/admin/projects`, { headers }),
        axios.get(`${API_URL}/admin/stats`, { headers }),
      ]);

      setUsers(usersRes.data);
      setProjects(projectsRes.data);
      setStats(statsRes.data);
    } catch (error) {
      console.error("Failed to load admin data:", error);
      alert("Failed to load admin data");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm("Are you sure you want to delete this user and all their projects?")) return;

    try {
      await axios.delete(`${API_URL}/admin/users/${userId}`, {
        headers: authService.getAuthHeaders(),
      });
      loadData();
    } catch (error: any) {
      alert(error.response?.data?.detail || "Failed to delete user");
    }
  };

  const handleToggleAdmin = async (userId: string) => {
    try {
      await axios.put(`${API_URL}/admin/users/${userId}/toggle-admin`, {}, {
        headers: authService.getAuthHeaders(),
      });
      loadData();
    } catch (error) {
      alert("Failed to toggle admin status");
    }
  };

  const handleDownloadBackup = async () => {
    try {
      const res = await axios.get(`${API_URL}/admin/backup`, {
        headers: authService.getAuthHeaders(),
        responseType: "blob",
      });

      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `grleaf_backup_${new Date().toISOString().split('T')[0]}.zip`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      alert("Failed to download backup");
    }
  };

  const handleRestoreBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!confirm("Restore will add data from the backup. Existing data will remain. Continue?")) {
      e.target.value = "";
      return;
    }

    try {
      const formData = new FormData();
      formData.append("file", file);

      await axios.post(`${API_URL}/admin/restore`, formData, {
        headers: {
          ...authService.getAuthHeaders(),
          "Content-Type": "multipart/form-data",
        },
      });

      alert("Backup restored successfully");
      loadData();
    } catch (error: any) {
      alert(error.response?.data?.detail || "Failed to restore backup");
    } finally {
      e.target.value = "";
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-green-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading admin dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Header */}
      <header className="bg-white border-b shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push("/")}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <Shield className="w-8 h-8 text-green-600" />
              <div>
                <h1 className="text-2xl font-bold text-gray-800">Admin Dashboard</h1>
                <p className="text-sm text-gray-500">Manage users, projects, and backups</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Stats */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Total Users</p>
                <p className="text-3xl font-bold text-gray-800">{stats?.total_users || 0}</p>
              </div>
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                <Users className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Total Projects</p>
                <p className="text-3xl font-bold text-gray-800">{stats?.total_projects || 0}</p>
              </div>
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                <FileText className="w-6 h-6 text-green-600" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">System Status</p>
                <p className="text-lg font-semibold text-green-600">Operational</p>
              </div>
              <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                <Activity className="w-6 h-6 text-purple-600" />
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="border-b border-gray-200 flex">
            <button
              onClick={() => setActiveTab("users")}
              className={`px-6 py-3 font-medium transition-colors ${
                activeTab === "users"
                  ? "text-green-600 border-b-2 border-green-600"
                  : "text-gray-600 hover:text-gray-800"
              }`}
            >
              Users ({users.length})
            </button>
            <button
              onClick={() => setActiveTab("projects")}
              className={`px-6 py-3 font-medium transition-colors ${
                activeTab === "projects"
                  ? "text-green-600 border-b-2 border-green-600"
                  : "text-gray-600 hover:text-gray-800"
              }`}
            >
              All Projects ({projects.length})
            </button>
            <button
              onClick={() => setActiveTab("backup")}
              className={`px-6 py-3 font-medium transition-colors ${
                activeTab === "backup"
                  ? "text-green-600 border-b-2 border-green-600"
                  : "text-gray-600 hover:text-gray-800"
              }`}
            >
              Backup & Restore
            </button>
          </div>

          <div className="p-6">
            {/* Users Tab */}
            {activeTab === "users" && (
              <div className="space-y-4">
                {users.map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                        <Users className="w-5 h-5 text-green-600" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-gray-800">{user.name || user.email}</p>
                          {user.is_admin && (
                            <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs font-medium rounded">
                              Admin
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-600">{user.email}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleToggleAdmin(user.id)}
                        className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
                        title={user.is_admin ? "Remove admin" : "Make admin"}
                      >
                        {user.is_admin ? (
                          <ShieldOff className="w-5 h-5 text-orange-600" />
                        ) : (
                          <Shield className="w-5 h-5 text-green-600" />
                        )}
                      </button>
                      <button
                        onClick={() => handleDeleteUser(user.id)}
                        className="p-2 hover:bg-red-100 rounded-lg transition-colors"
                        title="Delete user"
                      >
                        <Trash2 className="w-5 h-5 text-red-600" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Projects Tab */}
            {activeTab === "projects" && (
              <div className="space-y-4">
                {projects.map((project) => (
                  <div
                    key={project._id}
                    className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
                    onClick={() => router.push(`/editor/${project._id}`)}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                        <FileText className="w-5 h-5 text-blue-600" />
                      </div>
                      <div>
                        <p className="font-semibold text-gray-800">{project.name}</p>
                        <p className="text-sm text-gray-600">
                          {project.files?.length || 0} files • Owner: {project.owner_id}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Backup Tab */}
            {activeTab === "backup" && (
              <div className="space-y-6">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <Database className="w-5 h-5 text-blue-600 mt-0.5" />
                    <div>
                      <p className="font-medium text-blue-900 mb-1">Backup Strategy</p>
                      <p className="text-sm text-blue-800">
                        Download a complete backup of all user data, projects, and files. 
                        You can restore this backup later to recover or migrate data.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                  <div className="border border-gray-300 rounded-lg p-6">
                    <h3 className="text-lg font-semibold text-gray-800 mb-4">Download Backup</h3>
                    <p className="text-sm text-gray-600 mb-4">
                      Create a complete backup of all users, projects, and files as a ZIP file.
                    </p>
                    <button
                      onClick={handleDownloadBackup}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors font-medium"
                    >
                      <Download className="w-5 h-5" />
                      Download Backup
                    </button>
                  </div>

                  <div className="border border-gray-300 rounded-lg p-6">
                    <h3 className="text-lg font-semibold text-gray-800 mb-4">Restore Backup</h3>
                    <p className="text-sm text-gray-600 mb-4">
                      Upload a backup ZIP file to restore data. Existing data will remain intact.
                    </p>
                    <label className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-medium cursor-pointer">
                      <Upload className="w-5 h-5" />
                      Upload Backup
                      <input
                        type="file"
                        accept=".zip"
                        onChange={handleRestoreBackup}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>

                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <p className="text-sm text-yellow-800">
                    <strong>Note:</strong> The restore process will add data from the backup without 
                    deleting existing data. This allows you to merge backups safely.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
