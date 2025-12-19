"use client";
import { useState, useEffect } from "react";
import axios from "axios";
import { useRouter } from "next/navigation";

export default function Dashboard() {
  const [projects, setProjects] = useState([]);
  const router = useRouter();

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    const res = await axios.get("http://localhost:8000/projects");
    setProjects(res.data);
  };

  const createProject = async () => {
    const name = prompt("Project Name:");
    if (!name) return;
    const res = await axios.post("http://localhost:8000/projects?name=" + name);
    router.push(`/editor/${res.data.id}`);
  };

  return (
    <div className="p-10 bg-gray-50 min-h-screen">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-gray-800">My Projects</h1>
        <button 
          onClick={createProject}
          className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
        >
          New Project
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {projects.map((p: any) => (
          <div 
            key={p._id} 
            onClick={() => router.push(`/editor/${p._id}`)}
            className="bg-white p-6 rounded shadow cursor-pointer hover:shadow-lg transition"
          >
            <h2 className="font-semibold text-xl">{p.name}</h2>
            <p className="text-gray-500 text-sm mt-2">Last edited: Today</p>
          </div>
        ))}
      </div>
    </div>
  );
}