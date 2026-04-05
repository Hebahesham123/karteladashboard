"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Plus, Edit3, UserCheck, UserX, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@/types/database";

interface UserManagementProps {
  locale: string;
}

export function UserManagement({ locale }: UserManagementProps) {
  const isRTL = locale === "ar";
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [formData, setFormData] = useState({ email: "", full_name: "", role: "sales" as "admin" | "sales", password: "" });
  const [saving, setSaving] = useState(false);

  const fetchUsers = async () => {
    const supabase = createClient();
    const { data } = await supabase.from("users").select("*").order("created_at", { ascending: false });
    setUsers(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchUsers(); }, []);

  const handleToggleActive = async (user: User) => {
    const supabase = createClient() as any;
    await supabase.from("users").update({ is_active: !user.is_active }).eq("id", user.id);
    fetchUsers();
  };

  const handleSave = async () => {
    setSaving(true);
    const supabase = createClient() as any;

    if (editUser) {
      await supabase.from("users").update({
        full_name: formData.full_name,
        role: formData.role,
      }).eq("id", editUser.id);
    } else {
      // Create new user via admin API would require service role
      // For demo, just log
      console.log("Would create user:", formData);
    }

    setSaving(false);
    setShowAddDialog(false);
    setEditUser(null);
    fetchUsers();
  };

  const t = {
    addUser: isRTL ? "إضافة مستخدم" : "Add User",
    name: isRTL ? "الاسم" : "Name",
    email: isRTL ? "البريد الإلكتروني" : "Email",
    role: isRTL ? "الدور" : "Role",
    status: isRTL ? "الحالة" : "Status",
    actions: isRTL ? "الإجراءات" : "Actions",
    active: isRTL ? "نشط" : "Active",
    inactive: isRTL ? "غير نشط" : "Inactive",
    admin: isRTL ? "مدير" : "Admin",
    sales: isRTL ? "مبيعات" : "Sales",
    edit: isRTL ? "تعديل" : "Edit",
    save: isRTL ? "حفظ" : "Save",
    cancel: isRTL ? "إلغاء" : "Cancel",
    editUser: isRTL ? "تعديل مستخدم" : "Edit User",
    addUserTitle: isRTL ? "إضافة مستخدم جديد" : "Add New User",
    fullName: isRTL ? "الاسم الكامل" : "Full Name",
    password: isRTL ? "كلمة المرور" : "Password",
    createdAt: isRTL ? "تاريخ الإنشاء" : "Created",
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {Array(5).fill(0).map((_, i) => (
          <div key={i} className="h-16 bg-muted rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          onClick={() => { setFormData({ email: "", full_name: "", role: "sales", password: "" }); setShowAddDialog(true); }}
          className="gap-2"
        >
          <Plus className="h-4 w-4" />
          {t.addUser}
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {[t.name, t.email, t.role, t.status, t.createdAt, t.actions].map((h) => (
                  <th key={h} className="px-4 py-3 text-start text-xs font-semibold text-muted-foreground uppercase">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((user, i) => (
                <motion.tr
                  key={user.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.03 }}
                  className="border-b border-border/50 hover:bg-muted/30"
                >
                  <td className="px-4 py-3 font-medium text-sm">{user.full_name}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{user.email}</td>
                  <td className="px-4 py-3">
                    <Badge variant={user.role === "admin" ? "info" : "secondary"} className="text-xs">
                      {user.role === "admin" ? t.admin : t.sales}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={user.is_active ? "success" : "danger"} className="text-xs">
                      {user.is_active ? t.active : t.inactive}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {new Date(user.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setEditUser(user); setFormData({ email: user.email, full_name: user.full_name, role: user.role, password: "" }); setShowAddDialog(true); }}
                        className="h-7 px-2"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleActive(user)}
                        className="h-7 px-2"
                      >
                        {user.is_active ? (
                          <UserX className="h-3.5 w-3.5 text-red-500" />
                        ) : (
                          <UserCheck className="h-3.5 w-3.5 text-green-500" />
                        )}
                      </Button>
                    </div>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      {showAddDialog && (
        <Dialog open onOpenChange={() => { setShowAddDialog(false); setEditUser(null); }}>
          <DialogContent dir={isRTL ? "rtl" : "ltr"}>
            <DialogHeader>
              <DialogTitle>{editUser ? t.editUser : t.addUserTitle}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t.fullName}</label>
                <Input
                  value={formData.full_name}
                  onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                  placeholder={t.fullName}
                />
              </div>
              {!editUser && (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t.email}</label>
                    <Input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      placeholder="email@company.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t.password}</label>
                    <Input
                      type="password"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      placeholder="••••••••"
                    />
                  </div>
                </>
              )}
              <div className="space-y-2">
                <label className="text-sm font-medium">{t.role}</label>
                <Select
                  value={formData.role}
                  onValueChange={(v) => setFormData({ ...formData, role: v as "admin" | "sales" })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">{t.admin}</SelectItem>
                    <SelectItem value="sales">{t.sales}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => { setShowAddDialog(false); setEditUser(null); }}>
                {t.cancel}
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t.save}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
