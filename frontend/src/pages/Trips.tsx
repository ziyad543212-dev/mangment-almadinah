import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import type { Trip } from '../types';

function Trips() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [editingTrip, setEditingTrip] = useState<Trip | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    trip_date: '',
    trip_cost_usd: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    fetchTrips();
  }, [page, search, startDate, endDate]);

  const fetchTrips = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '10',
      });

      if (search) params.append('search', search);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);

      const response = await api.get(`/api/trips?${params.toString()}`);
      setTrips(response.data.trips);
      setTotalPages(response.data.pagination.totalPages);
    } catch (error) {
      alert('حدث خطأ في تحميل البيانات');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      if (editingTrip) {
        await api.put(`/api/trips/${editingTrip.id}`, formData);
        alert('تم تحديث الرحلة بنجاح');
      } else {
        await api.post('/api/trips', formData);
        alert('تمت إضافة الرحلة بنجاح');
      }
      setShowModal(false);
      setEditingTrip(null);
      setFormData({
        name: '',
        trip_date: '',
        trip_cost_usd: '',
        notes: '',
      });
      fetchTrips();
    } catch (error: any) {
      alert(error.response?.data?.error || 'حدث خطأ');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (trip: Trip) => {
    setEditingTrip(trip);
    setFormData({
      name: trip.name,
      trip_date: trip.trip_date.split('T')[0],
      trip_cost_usd: trip.trip_cost_usd?.toString() || '',
      notes: trip.notes || '',
    });
    setShowModal(true);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('هل أنت متأكد من حذف هذه الرحلة؟ سيتم حذف جميع المعتمرين والدفعات المرتبطة بها.')) {
      return;
    }

    setDeletingId(id);
    try {
      await api.delete(`/api/trips/${id}`);
      alert('تم حذف الرحلة بنجاح');
      fetchTrips();
    } catch (error: any) {
      alert(error.response?.data?.error || 'حدث خطأ');
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
        <div className="spinner" style={{ width: '40px', height: '40px' }}></div>
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          marginBottom: '2rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: '#1a1a2e', marginBottom: '0.5rem' }}>
            الرحلات
          </h1>
          <p style={{ color: '#666', margin: 0 }}>إدارة رحلات الحج والعمرة</p>
        </div>
        <button
          onClick={() => {
            setEditingTrip(null);
            setFormData({
              name: '',
              trip_date: '',
              trip_cost_usd: '',
              notes: '',
            });
            setShowModal(true);
          }}
          className="btn btn-primary"
        >
          <span>➕</span>
          <span>إضافة رحلة</span>
        </button>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <input
              type="text"
              className="form-input"
              placeholder="بحث باسم الرحلة..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div style={{ minWidth: '150px' }}>
            <input
              type="date"
              className="form-input"
              placeholder="من تاريخ"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div style={{ minWidth: '150px' }}>
            <input
              type="date"
              className="form-input"
              placeholder="إلى تاريخ"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0 }}>
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>اسم الرحلة</th>
                <th>تاريخ الرحلة</th>
                <th>عدد المعتمرين</th>
                <th>تكلفة الرحلة</th>
                <th>إجمالي المقبوض</th>
                <th>غير المقبوض</th>
                <th>صافي الرحلة</th>
                <th>الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {trips.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '3rem' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📭</div>
                    <p style={{ color: '#666', marginBottom: '1rem' }}>لا توجد رحلات حاليًا</p>
                    <button
                      onClick={() => {
                        setEditingTrip(null);
                        setFormData({
                          name: '',
                          trip_date: '',
                          trip_cost_usd: '',
                          notes: '',
                        });
                        setShowModal(true);
                      }}
                      className="btn btn-primary"
                    >
                      إضافة رحلة
                    </button>
                  </td>
                </tr>
              ) : (
                trips.map((trip) => (
                  <tr key={trip.id}>
                    <td>
                      <Link
                        to={`/trips/${trip.id}`}
                        style={{
                          color: '#D4AF37',
                          textDecoration: 'none',
                          fontWeight: '600',
                        }}
                      >
                        {trip.name}
                      </Link>
                    </td>
                    <td>{new Date(trip.trip_date).toLocaleDateString('ar-SA')}</td>
                    <td>{trip.pilgrim_count || 0}</td>
                    <td style={{ fontWeight: '600', color: '#D4AF37' }}>
                      ${trip.trip_cost_usd?.toFixed(2) || 0}
                    </td>
                    <td style={{ fontWeight: '600', color: '#28a745' }}>
                      ${trip.total_received?.toFixed(2) || 0}
                    </td>
                    <td style={{ fontWeight: '600', color: '#dc3545' }}>
                      ${trip.total_outstanding?.toFixed(2) || 0}
                    </td>
                    <td style={{ fontWeight: '600', color: (trip.net_trip ?? 0) >= 0 ? '#17a2b8' : '#dc3545' }}>
                      ${(trip.net_trip ?? 0)?.toFixed(2) || 0}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <Link
                          to={`/trips/${trip.id}`}
                          className="btn btn-sm btn-secondary"
                          style={{ textDecoration: 'none' }}
                        >
                          عرض
                        </Link>
                        <button
                          onClick={() => handleEdit(trip)}
                          className="btn btn-sm btn-secondary"
                        >
                          تعديل
                        </button>
                        <button
                          onClick={() => handleDelete(trip.id)}
                          className="btn btn-sm btn-danger"
                          disabled={deletingId === trip.id}
                        >
                          {deletingId === trip.id ? (
                            <span className="spinner" style={{ width: '12px', height: '12px' }}></span>
                          ) : (
                            'حذف'
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              padding: '1rem',
              borderTop: '1px solid var(--border-color)',
            }}
          >
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="btn btn-sm btn-secondary"
            >
              السابق
            </button>
            <span style={{ padding: '0 1rem' }}>
              صفحة {page} من {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="btn btn-sm btn-secondary"
            >
              التالي
            </button>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => !saving && setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">
                {editingTrip ? 'تعديل الرحلة' : 'إضافة رحلة جديدة'}
              </h2>
              <button
                onClick={() => !saving && setShowModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '1.5rem',
                  cursor: 'pointer',
                  color: '#666',
                }}
                disabled={saving}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">اسم الرحلة *</label>
                  <input
                    type="text"
                    className="form-input"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                    disabled={saving}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">تاريخ الرحلة *</label>
                  <input
                    type="date"
                    className="form-input"
                    value={formData.trip_date}
                    onChange={(e) => setFormData({ ...formData, trip_date: e.target.value })}
                    required
                    disabled={saving}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">تكلفة الرحلة ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="form-input"
                    value={formData.trip_cost_usd}
                    onChange={(e) => setFormData({ ...formData, trip_cost_usd: e.target.value })}
                    disabled={saving}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">ملاحظات</label>
                  <textarea
                    className="form-textarea"
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    disabled={saving}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => !saving && setShowModal(false)}
                  className="btn btn-secondary"
                  disabled={saving}
                >
                  إلغاء
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="spinner" style={{ width: '16px', height: '16px' }}></span>
                      جاري الحفظ...
                    </span>
                  ) : (
                    editingTrip ? 'تحديث' : 'إضافة'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Trips;
