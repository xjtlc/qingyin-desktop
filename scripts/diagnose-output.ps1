$qingyinCoreAudioSource = @'
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class QingyinMMDeviceEnumerator { }

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface QingyinIMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int flow, uint mask, out IntPtr devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out QingyinIMMDevice device);
    [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out QingyinIMMDevice device);
    [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr callback);
    [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr callback);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface QingyinIMMDevice {
    [PreserveSig] int Activate(ref Guid iid, uint context, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
    [PreserveSig] int OpenPropertyStore(uint access, out IntPtr store);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetState(out uint state);
}

[ComImport, Guid("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface QingyinIAudioClient {
    [PreserveSig] int Initialize(int shareMode, uint flags, long duration, long periodicity, IntPtr format, ref Guid session);
    [PreserveSig] int GetBufferSize(out uint frames);
    [PreserveSig] int GetStreamLatency(out long latency);
    [PreserveSig] int GetCurrentPadding(out uint frames);
    [PreserveSig] int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest);
    [PreserveSig] int GetMixFormat(out IntPtr format);
}

[StructLayout(LayoutKind.Sequential, Pack=2)]
struct QingyinWaveFormat {
    public ushort tag;
    public ushort channels;
    public uint sampleRate;
    public uint byteRate;
    public ushort blockAlign;
    public ushort bits;
    public ushort extraSize;
}

public class QingyinOutputFormat {
    public string role;
    public uint sampleRateHz;
    public ushort channels;
    public ushort mixContainerBits;
    public ushort mixValidBits;
    public string mixEncoding;
}

public static class QingyinOutputDiagnostics {
    public static QingyinOutputFormat Read(int role) {
        object enumeratorObject = new QingyinMMDeviceEnumerator();
        QingyinIMMDevice device = null;
        object clientObject = null;
        IntPtr format = IntPtr.Zero;
        try {
            var enumerator = (QingyinIMMDeviceEnumerator)enumeratorObject;
            Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, role, out device));
            var iid = new Guid("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2");
            Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out clientObject));
            var client = (QingyinIAudioClient)clientObject;
            Marshal.ThrowExceptionForHR(client.GetMixFormat(out format));
            var wave = (QingyinWaveFormat)Marshal.PtrToStructure(format, typeof(QingyinWaveFormat));
            ushort validBits = wave.bits;
            string encoding = wave.tag == 3 ? "IEEE float" : wave.tag == 1 ? "PCM integer" : "other";
            if (wave.tag == 65534 && wave.extraSize >= 22) {
                validBits = unchecked((ushort)Marshal.ReadInt16(format, 18));
                var subformat = (Guid)Marshal.PtrToStructure(IntPtr.Add(format, 24), typeof(Guid));
                encoding = subformat == new Guid("00000003-0000-0010-8000-00AA00389B71") ? "IEEE float" : subformat == new Guid("00000001-0000-0010-8000-00AA00389B71") ? "PCM integer" : "other";
            }
            return new QingyinOutputFormat { role = new [] { "console", "multimedia", "communications" }[role], sampleRateHz = wave.sampleRate, channels = wave.channels, mixContainerBits = wave.bits, mixValidBits = validBits, mixEncoding = encoding };
        } finally {
            if (format != IntPtr.Zero) Marshal.FreeCoTaskMem(format);
            if (clientObject != null) Marshal.ReleaseComObject(clientObject);
            if (device != null) Marshal.ReleaseComObject(device);
            Marshal.ReleaseComObject(enumeratorObject);
        }
    }
}
'@
Add-Type -TypeDefinition $qingyinCoreAudioSource -ErrorAction Stop
$qingyinFormats = foreach ($qingyinRole in 0, 1, 2) { [QingyinOutputDiagnostics]::Read($qingyinRole) }
$qingyinFormats | ConvertTo-Json -Depth 3
